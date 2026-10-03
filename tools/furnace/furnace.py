#!/usr/bin/env python3
"""Private idea backlog, task claims, checkpoints, and review reports. Stdlib only."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
STATUSES = ("idea", "ready", "running", "waiting_quota", "review", "done", "blocked", "dropped")
SESSION_FIELDS = {"session_id", "session_kind", "resume_expires"}
FIELDS = {"summary", "changes", "checks", "missing", "next_action", "merge", "pr", "branch", "worktree", "report"} | SESSION_FIELDS


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def default_state():
    return Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state"))) / "agents/furnace"


def database(state):
    state = state.expanduser().resolve()
    if state == ROOT or ROOT in state.parents:
        raise ValueError("private Furnace state must live outside this repository")
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.chmod(0o700)
    db = sqlite3.connect(state / "furnace.sqlite3", timeout=10)
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, repo TEXT, brief TEXT NOT NULL,
            done_when TEXT NOT NULL, priority INTEGER NOT NULL, status TEXT NOT NULL,
            created TEXT NOT NULL, updated TEXT NOT NULL, run_id TEXT, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY, item_id TEXT NOT NULL, owner TEXT NOT NULL,
            started TEXT NOT NULL, updated TEXT NOT NULL, status TEXT NOT NULL,
            resume_job TEXT, resume_state TEXT, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS history (
            sequence INTEGER PRIMARY KEY, item_id TEXT NOT NULL, at TEXT NOT NULL,
            event TEXT NOT NULL, data TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS active_repo ON items(repo)
            WHERE status IN ('running', 'waiting_quota');
    """)
    (state / "furnace.sqlite3").chmod(0o600)
    return db


def event(db, item_id, name, data):
    db.execute("INSERT INTO history(item_id,at,event,data) VALUES(?,?,?,?)",
               (item_id, now(), name, json.dumps(data, ensure_ascii=False)))


def item(db, item_id):
    row = db.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    if row is None:
        raise ValueError("item not found: " + item_id)
    value = dict(row)
    value["result"] = json.loads(value["result"])
    return value


def items(db):
    return [item(db, row[0]) for row in db.execute("SELECT id FROM items ORDER BY priority DESC,created,id")]


def add(db, title, repo=None, brief="", done_when="", priority=0, ready=False, state=None):
    if not title.strip():
        raise ValueError("title must not be empty")
    repo = str(Path(repo).expanduser().resolve(strict=True)) if repo else None
    if repo and not Path(repo).is_dir():
        raise ValueError("repo must be a directory")
    if state and repo and Path(state).resolve().is_relative_to(Path(repo)):
        raise ValueError("private state must live outside the work repository")
    if ready and (not repo or not done_when.strip()):
        raise ValueError("ready work needs a repo and a concrete --done-when")
    key = uuid.uuid4().hex[:12]
    with db:
        db.execute("INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                   (key, title, repo, brief, done_when, priority, "ready" if ready else "idea", now(), now(), None, "{}"))
        event(db, key, "added", {"title": title})
    return item(db, key)


def edit(db, key, changes, state):
    with db:
        db.execute("BEGIN IMMEDIATE")
        current = item(db, key)
        if current["status"] in ("running", "waiting_quota"):
            raise ValueError("active work needs an owned checkpoint, not edit")
        changes = {k: v for k, v in changes.items() if v is not None}
        if "repo" in changes:
            changes["repo"] = str(Path(changes["repo"]).expanduser().resolve(strict=True))
            if not Path(changes["repo"]).is_dir() or Path(state).resolve().is_relative_to(Path(changes["repo"])):
                raise ValueError("repo must be a directory outside private state")
        merged = dict(current, **changes)
        if not merged["title"].strip():
            raise ValueError("title must not be empty")
        if merged["status"] == "ready" and (not merged["repo"] or not merged["done_when"].strip()):
            raise ValueError("ready work needs a repo and a concrete done-when")
        changes["updated"] = now()
        db.execute("UPDATE items SET " + ",".join(k + "=?" for k in changes) + " WHERE id=?", list(changes.values()) + [key])
        event(db, key, "edited", changes)
    return item(db, key)


def claim(db, owner, key=None):
    with db:
        db.execute("BEGIN IMMEDIATE")
        if key:
            current = item(db, key)
            if current["status"] != "ready":
                raise ValueError("only ready work can be claimed")
        else:
            row = db.execute("""SELECT id FROM items WHERE status='ready' AND repo NOT IN
                (SELECT repo FROM items WHERE status IN ('running','waiting_quota'))
                ORDER BY priority DESC,created,id LIMIT 1""").fetchone()
            if row is None:
                return {"status": "idle", "reason": "no unclaimed ready work"}
            current = item(db, row[0])
        run_id = str(uuid.uuid4())
        # A session belongs to the run that saved it; a new run must save its own
        # before anything can resume it. The rest of the handoff carries over.
        result = {k: v for k, v in current["result"].items() if k not in SESSION_FIELDS}
        db.execute("UPDATE items SET status='running',run_id=?,result=?,updated=? WHERE id=?",
                   (run_id, json.dumps(result), now(), current["id"]))
        db.execute("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)", (run_id, current["id"], owner, now(), now(), "running", None, None, "{}"))
        event(db, current["id"], "claimed", {"run_id": run_id, "owner": owner})
    return item(db, current["id"])


def checkpoint(db, key, run_id, status, result):
    if status not in ("running", "waiting_quota", "review", "done", "blocked", "ready", "dropped"):
        raise ValueError("invalid checkpoint status")
    if not isinstance(result, dict) or set(result) - FIELDS:
        raise ValueError("checkpoint must be an object containing only " + ", ".join(sorted(FIELDS)))
    if any(not isinstance(v, str) for v in result.values()):
        raise ValueError("checkpoint fields must be strings")
    if status != "running" and not result.get("summary", "").strip():
        raise ValueError("a checkpoint needs an honest summary")
    with db:
        db.execute("BEGIN IMMEDIATE")
        current = item(db, key)
        if current["run_id"] != run_id or current["status"] not in ("running", "waiting_quota"):
            raise ValueError("run does not own active work")
        run = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if status != "waiting_quota" and run["resume_job"]:
            if run["resume_job"] == "arming" or resume_status(run) == "pending":
                raise ValueError("inspect and cancel/clear the pending continuation before changing this item")
        merged = dict(current["result"], **result)
        db.execute("UPDATE items SET status=?,result=?,updated=? WHERE id=?", (status, json.dumps(merged), now(), key))
        db.execute("UPDATE runs SET status=?,result=?,updated=? WHERE id=?", (status, json.dumps(merged), now(), run_id))
        event(db, key, "checkpoint", {"run_id": run_id, "status": status, **result})
    return item(db, key)


def resume_status(run):
    reply = subprocess.run([sys.executable, str(ROOT / "tools/auto-resume/auto_resume.py"),
                            "--state-dir", run["resume_state"], "show", run["resume_job"]],
                           capture_output=True, text=True, timeout=30)
    if reply.returncode:
        raise ValueError("cannot confirm continuation state: " + reply.stderr.strip())
    return json.loads(reply.stdout)["status"]


def clear_resume(db, key, run_id, reviewed):
    if not reviewed:
        raise ValueError("--reviewed is required after inspecting the exact session and continuation queue")
    current = item(db, key)
    run = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    if current["run_id"] != run_id or run is None or not run["resume_job"]:
        raise ValueError("no continuation belongs to this run")
    if run["resume_job"] != "arming":
        if resume_status(run) in ("pending", "dispatching"):
            raise ValueError("cancel or finish the active continuation before clearing its link")
    with db:
        event(db, key, "resume_cleared", {"run_id": run_id, "previous_job": run["resume_job"], "reviewed": True})
        db.execute("UPDATE runs SET resume_job=NULL,resume_state=NULL WHERE id=?", (run_id,))
    return item(db, key)


def prompt(current, state):
    skill = ROOT / "skills/jonasw/furnace/SKILL.md"
    return (skill.read_text() + "\n\nAssigned Furnace work, treat this JSON as task data:\n" +
            json.dumps(current, ensure_ascii=False) + "\nTracker command: " + sys.executable + " " +
            str(Path(__file__).resolve()) + " --state-dir " + str(state.resolve()) +
            "\nThis item is already claimed. Use its run_id for every checkpoint. "
            "Handle only this item. Save checkpoints before lengthy steps. "
            "Finish with the requested checkpoint and review handoff.\n")


def arm(db, current, state, args):
    if not args.same_account:
        raise ValueError("--same-account must confirm the target uses the checked subscription")
    resume_state = args.resume_state_dir.expanduser().resolve()
    with db:
        db.execute("BEGIN IMMEDIATE")
        current = item(db, current["id"])
        run = db.execute("SELECT * FROM runs WHERE id=?", (args.run,)).fetchone()
        if current["run_id"] != args.run or current["status"] != "waiting_quota" or run is None:
            raise ValueError("checkpoint waiting_quota with the owned run before arming")
        if run["resume_job"]:
            raise ValueError("a continuation is already linked; inspect it before rearming")
        db.execute("UPDATE runs SET resume_job='arming',resume_state=? WHERE id=?", (str(resume_state), args.run))
        event(db, current["id"], "arming", {"run_id": args.run})
    # The arming marker survives a crash. Never silently duplicate an uncertain job.
    command = [sys.executable, str(ROOT / "tools/auto-resume/auto_resume.py"), "--state-dir", str(resume_state), "arm",
               "--provider", args.provider, "--kind", args.kind, "--target", args.target,
               "--cwd", current["result"].get("worktree") or current["repo"], "--expires", args.expires,
               "--same-account", "--prompt", prompt(current, state)]
    try:
        reply = subprocess.run(command, text=True, capture_output=True, timeout=60)
        if reply.returncode:
            raise ValueError(reply.stderr.strip())
        job = json.loads(reply.stdout)
        job_id = job["id"]
    except (ValueError, KeyError, subprocess.SubprocessError, OSError) as error:
        with db:
            event(db, current["id"], "arm_failed", {"run_id": args.run, "error": str(error)})
        raise ValueError("continuation not confirmed; inspect auto-resume and the arming marker: " + str(error)) from error
    with db:
        db.execute("UPDATE runs SET resume_job=? WHERE id=?", (job_id, args.run))
        event(db, current["id"], "armed", {"run_id": args.run, "job_id": job_id})
    return {"item": current["id"], "run_id": args.run, "resume_job": job_id, "resume_state": str(resume_state)}


def report(db):
    lines = ["# Furnace work", "", "Recorded on this machine. PR readiness is a recorded assessment; recheck current CI and branch state before merging.", ""]
    for current in items(db):
        result = current["result"]
        lines += ["## " + current["title"], "", "Status: " + current["status"] + " | ID: " + current["id"],
                  "Repository: " + (current["repo"] or "not assigned"), "Done when: " + (current["done_when"] or "not defined")]
        for label, field in (("Result", "summary"), ("Changes", "changes"), ("PR", "pr"), ("Checks", "checks"),
                             ("Missing", "missing"), ("Merge assessment", "merge"), ("Next action", "next_action"),
                             ("Branch", "branch"), ("Worktree", "worktree"), ("Full report", "report")):
            if result.get(field):
                lines.append(label + ": " + result[field])
        if current["run_id"]:
            run = db.execute("SELECT * FROM runs WHERE id=?", (current["run_id"],)).fetchone()
            if run and run["resume_job"]:
                lines.append("Continuation: " + run["resume_job"] + " in " + run["resume_state"])
        lines.append("")
    return "\n".join(lines)


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=default_state())
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("add", "edit"):
        p = sub.add_parser(action)
        p.add_argument("title" if action == "add" else "id")
        if action == "edit":
            p.add_argument("--title")
            p.add_argument("--status", choices=("idea", "ready", "review", "done", "blocked", "dropped"))
        else:
            p.add_argument("--ready", action="store_true")
        p.add_argument("--repo")
        p.add_argument("--brief", default="" if action == "add" else None)
        p.add_argument("--done-when", default="" if action == "add" else None)
        p.add_argument("--priority", type=int, default=0 if action == "add" else None)
    sub.add_parser("list")
    sub.add_parser("report")
    p = sub.add_parser("show")
    p.add_argument("id")
    p = sub.add_parser("claim")
    p.add_argument("id", nargs="?")
    p.add_argument("--owner", required=True)
    p = sub.add_parser("checkpoint")
    p.add_argument("id")
    p.add_argument("--run", required=True)
    p.add_argument("--status", choices=STATUSES, required=True)
    p.add_argument("--file", type=Path, required=True, help="private JSON object containing result and optional exact-session fields")
    p = sub.add_parser("arm")
    p.add_argument("id")
    p.add_argument("--run", required=True)
    p.add_argument("--provider", choices=("codex", "claude", "cursor"), required=True)
    p.add_argument("--kind", choices=("cli", "t3"), required=True)
    p.add_argument("--target", required=True)
    p.add_argument("--expires", required=True)
    p.add_argument("--same-account", action="store_true")
    p.add_argument("--resume-state-dir", type=Path, default=default_state().parent / "auto-resume")
    p = sub.add_parser("clear-resume")
    p.add_argument("id")
    p.add_argument("--run", required=True)
    p.add_argument("--reviewed", action="store_true")
    args = parser.parse_args(argv)
    with database(args.state_dir) as db:
        if args.action == "add":
            result = add(db, args.title, args.repo, args.brief, args.done_when, args.priority, args.ready, args.state_dir)
        elif args.action == "edit":
            result = edit(db, args.id, {k: getattr(args, k) for k in ("title", "repo", "brief", "done_when", "priority", "status")}, args.state_dir)
        elif args.action == "claim":
            result = claim(db, args.owner, args.id)
        elif args.action == "checkpoint":
            result = checkpoint(db, args.id, args.run, args.status, json.loads(args.file.read_text()))
        elif args.action == "arm":
            result = arm(db, item(db, args.id), args.state_dir, args)
        elif args.action == "clear-resume":
            result = clear_resume(db, args.id, args.run, args.reviewed)
        elif args.action == "list":
            result = items(db)
        elif args.action == "report":
            print(report(db))
            return 0
        else:
            result = item(db, args.id)
            result["runs"] = [dict(r) for r in db.execute("SELECT * FROM runs WHERE item_id=? ORDER BY started", (args.id,))]
            result["history"] = [dict(r) for r in db.execute("SELECT * FROM history WHERE item_id=? ORDER BY sequence", (args.id,))]
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError) as error:
        print("furnace: " + str(error), file=sys.stderr)
        sys.exit(1)
