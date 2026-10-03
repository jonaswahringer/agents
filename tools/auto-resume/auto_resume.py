#!/usr/bin/env python3
"""Explicit, one-shot continuations gated by subscription quota. Stdlib only."""
import argparse
import contextlib
import datetime as dt
import fcntl
import json
import math
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
PROVIDERS = {"codex": "Codex", "claude": "Claude Code", "cursor": "Cursor"}
GUARD = ("Continue only the already authorized task. Preserve all existing approval "
         "requirements, including asking before git commit, push, tagging, or amending "
         "remote commits unless the user already explicitly authorized those exact actions "
         "for this task. Preserve that authorization without broadening it. "
         "Stop if the task is complete or requires human input. Do not "
         "switch provider/model, use paid API fallback, or bypass permissions.")


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("timestamp must be an ISO 8601 string with timezone")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed.timestamp()


def iso(value):
    return dt.datetime.fromtimestamp(value, dt.timezone.utc).isoformat()


def command(value, label):
    if not isinstance(value, list) or not value or any(not isinstance(x, str) or not x for x in value):
        raise ValueError(label + " must be a nonempty argv array")
    return value


def config(state):
    result = {"usage_command": [str(ROOT / "bin/usage")],
              "provider_commands": {"codex": ["codex"], "claude": ["claude"], "cursor": ["cursor-agent"]},
              "t3_adapter": None, "check_timeout_seconds": 30,
              "dispatch_timeout_seconds": 3600, "retry_delay_seconds": 60}
    path = state / "config.json"
    if path.exists():
        incoming = json.loads(path.read_text())
        if not isinstance(incoming, dict) or set(incoming) - set(result):
            raise ValueError("config.json has unknown keys or is not an object")
        result.update(incoming)
    command(result["usage_command"], "usage_command")
    if not isinstance(result["provider_commands"], dict):
        raise ValueError("provider_commands must be an object")
    for provider in PROVIDERS:
        # Only executable paths are configurable. Resume flags stay under our control.
        prefix = command(result["provider_commands"].get(provider), "provider_commands." + provider)
        if len(prefix) != 1:
            raise ValueError("provider_commands entries must contain one executable path")
    if result["t3_adapter"] is not None:
        command(result["t3_adapter"], "t3_adapter")
    for key in ("check_timeout_seconds", "dispatch_timeout_seconds", "retry_delay_seconds"):
        value = result[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(key + " must be a positive finite number")
    return result


def database(state):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state, 0o700)
    db = sqlite3.connect(str(state / "jobs.sqlite3"), timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, kind TEXT NOT NULL,
        target TEXT NOT NULL, cwd TEXT NOT NULL, prompt TEXT NOT NULL,
        expires REAL NOT NULL, buffer INTEGER NOT NULL, windows TEXT NOT NULL,
        max_retries INTEGER NOT NULL, max_attempts INTEGER NOT NULL,
        retries INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
        revision TEXT, status TEXT NOT NULL, next_check REAL NOT NULL,
        created REAL NOT NULL, updated REAL NOT NULL, message TEXT NOT NULL,
        reserve REAL NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS history (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
        at REAL NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS active_target ON jobs(provider,kind,target)
        WHERE status IN ('pending','dispatching');
    """)
    if "reserve" not in {row["name"] for row in db.execute("PRAGMA table_info(jobs)")}:
        # Jobs armed before reserves existed keep no reserve.
        db.execute("ALTER TABLE jobs ADD COLUMN reserve REAL NOT NULL DEFAULT 0")
    return db


def event(db, job_id, status, message, now=None, **fields):
    now = time.time() if now is None else now
    fields.update(status=status, message=message, updated=now)
    db.execute("UPDATE jobs SET " + ",".join(key + "=?" for key in fields) + " WHERE id=?",
               list(fields.values()) + [job_id])
    db.execute("INSERT INTO history(job_id,at,status,message) VALUES(?,?,?,?)",
               (job_id, now, status, message))


def run_process(argv, cwd, timeout, env=None, output=None):
    """Kill the whole child group before releasing the scheduler lock on timeout."""
    with subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL,
                          stdout=output if output is not None else subprocess.PIPE,
                          stderr=output if output is not None else subprocess.PIPE,
                          text=True, env=env, start_new_session=True) as process:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except BaseException:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise
        return process.returncode, stdout


def json_run(argv, cwd, timeout, env=None):
    returncode, stdout = run_process(argv, cwd, timeout, env)
    if returncode:
        # Do not copy credentials or private subprocess output into status messages.
        raise ValueError("command exited " + str(returncode))
    payload = json.loads(stdout)
    return payload


def inspect(cfg, target, cwd, provider):
    if not cfg["t3_adapter"]:
        raise ValueError("T3 adapter is not configured; raw CLI cannot update a T3 thread")
    env = dict(os.environ, AUTO_RESUME_PROVIDER=provider, AUTO_RESUME_CWD=cwd)
    reply = json_run(cfg["t3_adapter"] + ["inspect", target], cwd, cfg["check_timeout_seconds"], env)
    if not isinstance(reply, dict) or reply.get("status") not in {"idle", "running", "completed", "blocked", "cancelled"}:
        raise ValueError("T3 adapter returned malformed status")
    if not isinstance(reply.get("revision"), str) or not reply["revision"]:
        raise ValueError("T3 inspection unavailable: " + str(reply.get("message", "adapter must provide a revision"))[:250])
    return reply


def quota(payload, provider, selected, now, buffer, reserve=0):
    """Return when to check again, or None when every window is above the reserve."""
    if not isinstance(payload, list):
        raise ValueError("usage reply must be a provider array")
    rows = [row for row in payload if isinstance(row, dict) and row.get("provider") == PROVIDERS[provider]]
    if len(rows) != 1 or rows[0].get("ok") is not True or rows[0].get("stale_at") is not None:
        raise ValueError("quota unavailable, stale, or missing")
    windows = rows[0].get("windows")
    if not isinstance(windows, list) or not windows:
        raise ValueError("quota windows missing")
    labels = [window.get("label") for window in windows if isinstance(window, dict)]
    if len(labels) != len(windows) or any(not isinstance(x, str) or not x for x in labels) or len(set(labels)) != len(labels):
        raise ValueError("malformed quota window labels")
    if selected and set(selected) - set(labels):
        raise ValueError("selected quota window missing")
    necessary = []
    for window in windows:
        if selected and window["label"] not in selected:
            continue
        used = window.get("used_percent")
        if isinstance(used, bool) or not isinstance(used, (int, float)) or not math.isfinite(used) or used < 0:
            raise ValueError("malformed used_percent")
        # A window down to its reserve waits for its reset like an exhausted one.
        if used >= 100 - reserve:
            reset = timestamp(window.get("resets_at")) + buffer
            if reset <= now:
                raise ValueError("quota still exhausted or at the reserve after reported reset")
            necessary.append(reset)
    return max(necessary) if necessary else None


def auth_environment(provider):
    # Quota is for the subscription login. API credentials can cause paid dispatch.
    prohibited = {
        "codex": ("OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"),
        "claude": ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"),
        "cursor": ("CURSOR_API_KEY", "CURSOR_API_ENDPOINT"),
    }[provider]
    if any(os.environ.get(key) for key in prohibited):
        raise ValueError("API credentials or alternate provider routing set; subscription-only dispatch refused")


def retry(db, job, cfg, reason):
    with db:
        current = db.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone()
        if current["status"] != "pending":
            return
        count = current["retries"] + 1
        exhausted = count > current["max_retries"]
        event(db, job["id"], "failed" if exhausted else "pending", reason,
              retries=count, next_check=time.time() + cfg["retry_delay_seconds"])


def tick(db, state, cfg):
    with (state / "tick.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "busy", "message": "another tick is running"}
        # A process that died after claiming dispatch cannot safely replay a prompt.
        with db:
            for job in db.execute("SELECT id FROM jobs WHERE status='dispatching'").fetchall():
                event(db, job["id"], "needs_review", "previous tick ended during dispatch; inspect the session before rearming")
            now = time.time()
            for job in db.execute("SELECT id FROM jobs WHERE status='pending' AND expires<=?", (now,)).fetchall():
                event(db, job["id"], "expired", "deadline passed")
        jobs = db.execute("SELECT * FROM jobs WHERE status='pending' AND next_check<=? ORDER BY created", (time.time(),)).fetchall()
        for job in jobs:
            process_job(db, state, cfg, job)
        return {"status": "ok", "checked": len(jobs)}


def process_job(db, state, cfg, job):
    try:
        auth_environment(job["provider"])
        reply = json_run(cfg["usage_command"] + ["--json", "--only", job["provider"]],
                         job["cwd"], cfg["check_timeout_seconds"])
        reset = quota(reply, job["provider"], json.loads(job["windows"]), time.time(), job["buffer"], job["reserve"])
        if reset is not None:
            reason = "quota exhausted or at the %g%% reserve" % job["reserve"] if job["reserve"] else "quota exhausted"
            with db:
                current = db.execute("SELECT status FROM jobs WHERE id=?", (job["id"],)).fetchone()
                if current["status"] == "pending":
                    event(db, job["id"], "pending", reason + "; check after " + iso(reset), next_check=reset)
            return
        if job["kind"] == "t3":
            check = inspect(cfg, job["target"], job["cwd"], job["provider"])
            if check["status"] != "idle" or check["revision"] != job["revision"]:
                with db:
                    current = db.execute("SELECT status FROM jobs WHERE id=?", (job["id"],)).fetchone()
                    if current["status"] == "pending":
                        event(db, job["id"], "needs_review", "T3 thread is " + check["status"] + " or changed since arming")
                return
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        retry(db, job, cfg, "check failed: " + type(error).__name__ + ": " + str(error)[:250])
        return
    with db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone()
        if current["status"] != "pending":
            return
        if time.time() >= current["expires"]:
            event(db, job["id"], "expired", "deadline passed before dispatch")
            return
        if current["attempts"] >= current["max_attempts"]:
            event(db, job["id"], "failed", "dispatch attempt budget exhausted")
            return
        event(db, job["id"], "dispatching", "continuation dispatch claimed", attempts=current["attempts"] + 1)
    prompt = GUARD + "\n\n" + job["prompt"]
    try:
        if job["kind"] == "t3":
            env = dict(os.environ, AUTO_RESUME_EXPECTED_REVISION=job["revision"],
                       AUTO_RESUME_JOB_ID=job["id"], AUTO_RESUME_PROVIDER=job["provider"],
                       AUTO_RESUME_CWD=job["cwd"])
            response = json_run(cfg["t3_adapter"] + ["resume", job["target"], prompt],
                                job["cwd"], cfg["check_timeout_seconds"], env)
            if not isinstance(response, dict) or not isinstance(response.get("accepted"), bool):
                raise ValueError("malformed dispatch acknowledgment")
            if not response["accepted"]:
                # Retry only an adapter's explicit assertion that no message was sent.
                if response.get("retryable") is True and response.get("not_sent") is True:
                    with db:
                        event(db, job["id"], "pending", "adapter did not send; retry requested")
                    retry(db, job, cfg, "adapter did not send; retry requested")
                    return
                raise ValueError("T3 refused continuation: " + str(response.get("message", response.get("reason", "inspect before rearming")))[:250])
            outcome = "T3 accepted one continuation; task completion is not inferred"
        else:
            arguments = {"codex": ["exec", "resume", job["target"], prompt],
                         "claude": ["--print", "--resume", job["target"], prompt],
                         "cursor": ["--print", "--resume", job["target"], prompt]}[job["provider"]]
            log_dir = state / "logs"
            log_dir.mkdir(exist_ok=True, mode=0o700)
            with (log_dir / (job["id"] + ".log")).open("a") as log:
                returncode, _ = run_process(cfg["provider_commands"][job["provider"]] + arguments,
                                           job["cwd"], cfg["dispatch_timeout_seconds"], output=log)
            if returncode:
                raise ValueError("provider exited " + str(returncode) + "; it may have sent a prompt")
            outcome = "provider returned successfully after one continuation; task completion is not inferred"
        with db:
            event(db, job["id"], "resumed", outcome)
    except OSError as error:
        with db:
            event(db, job["id"], "pending", "dispatch could not start")
        retry(db, job, cfg, "dispatch could not start: " + type(error).__name__)
    except (ValueError, subprocess.SubprocessError) as error:
        with db:
            event(db, job["id"], "needs_review", "dispatch uncertain: " + str(error)[:250])


def arm(db, cfg, args):
    now = time.time()
    expires = timestamp(args.expires)
    if expires <= now:
        raise ValueError("expiry must be in the future")
    cwd = str(Path(args.cwd).expanduser().resolve(strict=True))
    if not Path(cwd).is_dir():
        raise ValueError("cwd must be a directory")
    if not args.same_account:
        raise ValueError("--same-account is required: confirm usage and target share the same subscription login")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}", args.target):
        raise ValueError("target must be an exact session/thread ID, not options or a path")
    if args.kind == "cli" and args.provider in {"codex", "claude"}:
        try:
            uuid.UUID(args.target)
        except ValueError as error:
            raise ValueError("Codex and Claude CLI targets must be exact UUID session IDs") from error
    if not args.prompt.strip():
        raise ValueError("continuation prompt must not be empty")
    auth_environment(args.provider)
    revision = None
    if args.kind == "t3":
        reply = inspect(cfg, args.target, cwd, args.provider)
        if reply["status"] != "idle":
            raise ValueError("T3 thread must be idle at arming; got " + reply["status"])
        if reply.get("resume_supported") is False:
            raise ValueError("T3 resume unavailable: " + str(reply.get("resume_limitation", reply.get("reason", "adapter cannot safely resume"))))
        revision = reply["revision"]
    job_id = str(uuid.uuid4())
    with db:
        db.execute("""INSERT INTO jobs(id,provider,kind,target,cwd,prompt,expires,buffer,windows,
          max_retries,max_attempts,revision,status,next_check,created,updated,message,reserve)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
          (job_id, args.provider, args.kind, args.target, cwd, args.prompt, expires,
           args.buffer, json.dumps(args.window), args.max_retries, args.max_attempts,
           revision, "pending", now, now, now, "explicitly armed for one continuation", args.reserve_percent))
        event(db, job_id, "pending", "explicitly armed for one continuation")
    return dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())


def bounded_int(low, high):
    def parse(value):
        number = int(value)
        if not low <= number <= high:
            raise argparse.ArgumentTypeError("must be between %d and %d" % (low, high))
        return number
    return parse


def percent_below_100(value):
    number = float(value)
    if not math.isfinite(number) or not 0 <= number < 100:
        raise argparse.ArgumentTypeError("must be at least 0 and below 100")
    return number


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    default_state = Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state"))) / "agents/auto-resume"
    parser.add_argument("--state-dir", default=str(default_state))
    sub = parser.add_subparsers(dest="action", required=True)
    add = sub.add_parser("arm", help="arm one continuation for an exact session or T3 thread")
    add.add_argument("--provider", choices=PROVIDERS, required=True)
    add.add_argument("--kind", choices=("cli", "t3"), default="cli")
    add.add_argument("--target", required=True)
    add.add_argument("--cwd", required=True)
    add.add_argument("--expires", required=True, help="ISO 8601 with timezone")
    add.add_argument("--prompt", required=True)
    add.add_argument("--same-account", action="store_true")
    add.add_argument("--buffer", type=bounded_int(0, 60), default=30)
    add.add_argument("--window", action="append", default=[], help="exact quota label; repeat; default all")
    add.add_argument("--reserve-percent", type=percent_below_100, default=0,
                     help="treat a window with this much or less left as exhausted until it resets")
    add.add_argument("--max-retries", type=bounded_int(0, 100), default=3)
    add.add_argument("--max-attempts", type=bounded_int(1, 100), default=3)
    sub.add_parser("tick", help="check due jobs once; suitable for cron")
    sub.add_parser("list", help="show all jobs and their outcomes")
    show = sub.add_parser("show")
    show.add_argument("id")
    cancel = sub.add_parser("cancel")
    cancel.add_argument("id")
    args = parser.parse_args(argv)
    state = Path(args.state_dir).expanduser().resolve()
    if state == ROOT or ROOT in state.parents:
        parser.error("private state must live outside this repository")
    try:
        db = database(state)
        with contextlib.closing(db):
            if args.action == "arm":
                result = arm(db, config(state), args)
            elif args.action == "tick":
                result = tick(db, state, config(state))
            elif args.action == "list":
                result = [dict(row) for row in db.execute("SELECT * FROM jobs ORDER BY created")]
            else:
                job = db.execute("SELECT * FROM jobs WHERE id=?", (args.id,)).fetchone()
                if job is None:
                    raise ValueError("job not found")
                if args.action == "cancel":
                    with db:
                        db.execute("BEGIN IMMEDIATE")
                        job = db.execute("SELECT * FROM jobs WHERE id=?", (args.id,)).fetchone()
                        if job["status"] == "dispatching":
                            raise ValueError("dispatch already claimed; cancel cannot withdraw an active continuation")
                        if job["status"] == "pending":
                            event(db, args.id, "cancelled", "cancelled by user")
                    result = dict(db.execute("SELECT * FROM jobs WHERE id=?", (args.id,)).fetchone())
                else:
                    result = dict(job)
                    result["history"] = [dict(row) for row in db.execute("SELECT * FROM history WHERE job_id=? ORDER BY sequence", (args.id,))]
            print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError) as error:
        print("auto-resume: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
