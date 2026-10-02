"""One quota-gated Furnace task per workflow invocation."""
import datetime as dt
import importlib.util
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def settings(path):
    value = json.loads(path.expanduser().read_text()).get("furnace")
    if not isinstance(value, dict):
        raise ValueError("workflows config needs a furnace object")
    cfg = dict(value)
    cfg.setdefault("enabled", False)
    cfg.setdefault("auto_resume", False)
    cfg.setdefault("provider", "codex")
    cfg.setdefault("weekly_window", "Weekly")
    cfg.setdefault("within_hours", 48)
    cfg.setdefault("reserve_percent", 10)
    cfg.setdefault("command_timeout_seconds", 30)
    cfg.setdefault("agent_timeout_seconds", 3600)
    cfg.setdefault("usage_command", [str(ROOT / "bin/usage")])
    if cfg["provider"] not in ("codex", "claude", "cursor"):
        raise ValueError("unsupported Furnace provider")
    if any(not isinstance(cfg.get(key, False), bool) for key in ("enabled", "same_account", "auto_resume")):
        raise ValueError("enabled, same_account and auto_resume must be booleans")
    if not isinstance(cfg["weekly_window"], str) or not cfg["weekly_window"].strip():
        raise ValueError("weekly_window must be an exact quota label")
    for key in ("within_hours", "reserve_percent", "command_timeout_seconds", "agent_timeout_seconds"):
        number = cfg[key]
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or number <= 0:
            raise ValueError(key + " must be a positive finite number")
    if cfg["reserve_percent"] >= 100:
        raise ValueError("reserve_percent must be below 100")
    return cfg


def gate(cfg, command, resume):
    if not cfg["enabled"]:
        return {"status": "disabled", "reason": "Furnace scheduling is not enabled"}
    if cfg.get("same_account") is not True:
        return {"status": "deferred", "reason": "confirm quota and agent use the same subscription account"}
    resume.auth_environment(cfg["provider"])
    resume.command(cfg["usage_command"], "furnace.usage_command")
    payload = json.loads(command(cfg["usage_command"] + ["--json", "--only", cfg["provider"]], cfg["command_timeout_seconds"]))
    now = dt.datetime.now(dt.timezone.utc)
    reset = resume.quota(payload, cfg["provider"], [], now.timestamp(), 0)
    if reset is not None:
        return {"status": "deferred", "reason": "a quota window is exhausted", "next_reset": resume.iso(reset)}
    row = next(r for r in payload if r["provider"] == resume.PROVIDERS[cfg["provider"]])
    windows = row["windows"]
    weekly = next((w for w in windows if w["label"] == cfg["weekly_window"]), None)
    if weekly is None:
        return {"status": "deferred", "reason": "configured weekly quota window is missing"}
    seconds = resume.timestamp(weekly["resets_at"]) - now.timestamp()
    if not 0 < seconds <= cfg["within_hours"] * 3600:
        return {"status": "deferred", "reason": "outside the pre-reset window"}
    if any(100 - w["used_percent"] <= cfg["reserve_percent"] for w in windows):
        return {"status": "deferred", "reason": "allowance reserve reached"}
    return {"status": "eligible", "provider": cfg["provider"], "weekly_reset": weekly["resets_at"],
            "reserve_percent": cfg["reserve_percent"]}


def main(args, command):
    tracker = module("furnace_tracker", ROOT / "tools/furnace/furnace.py")
    resume = module("furnace_resume", ROOT / "tools/auto-resume/auto_resume.py")
    # Furnace state has its own path; digest --state-dir remains independent.
    state = args.furnace_state_dir.expanduser().resolve()
    db = tracker.database(state)
    try:
        if args.action == "status":
            print(json.dumps({"items": tracker.items(db), "state": str(state)}))
            return 0
        if args.action == "history":
            print(json.dumps({"runs": [dict(r) for r in db.execute("SELECT * FROM runs ORDER BY started DESC LIMIT 50")],
                              "history": [dict(r) for r in db.execute("SELECT * FROM history ORDER BY sequence DESC LIMIT 100")]}))
            return 0
        cfg = settings(args.config)
        try:
            eligible = gate(cfg, command, resume)
        except (OSError, ValueError, RuntimeError, KeyError, TypeError, StopIteration) as error:
            eligible = {"status": "deferred", "reason": "quota could not be confirmed: " + str(error)}
        if args.action == "collect" or eligible["status"] != "eligible":
            print(json.dumps({**eligible, "ready": [i["id"] for i in tracker.items(db) if i["status"] == "ready"]}))
            return 0
        agent = cfg.get("agent_command")
        resume.command(agent, "furnace.agent_command")
        # Refuse overlapping schedulers even when they select different repos.
        # Claims themselves also protect against interactive agents and crashes.
        import fcntl
        with (state / "workflow.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print(json.dumps({"status": "busy"}))
                return 0
            if db.execute("SELECT 1 FROM items WHERE status IN ('running','waiting_quota')").fetchone():
                print(json.dumps({"status": "busy", "reason": "inspect or finish the existing active item"}))
                return 0
            current = tracker.claim(db, "workflows/furnace")
            if current.get("status") == "idle":
                print(json.dumps(current))
                return 0
            run_id = current["run_id"]
            log = state / ("agent-" + run_id + ".log")
            failure = None
            try:
                output = command(agent, cfg["agent_timeout_seconds"], tracker.prompt(current, state), current["repo"])
                log.write_text(output, encoding="utf-8")
                log.chmod(0o600)
            except (OSError, ValueError, RuntimeError) as error:
                failure = str(error)
            latest = tracker.item(db, current["id"])
            if latest["status"] == "running":
                latest = tracker.checkpoint(db, latest["id"], run_id, "blocked", {
                    "summary": failure or "Agent returned without a final checkpoint; completion is unverified.",
                    "next_action": "Inspect the branch, worktree, run history and agent log before requeueing.",
                    "report": str(log) if log.exists() else "No successful agent output was captured."})
            continuation = None
            resume_error = None
            if latest["status"] == "waiting_quota" and cfg["auto_resume"]:
                run = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
                result = latest["result"]
                if run["resume_job"]:
                    continuation = {"resume_job": run["resume_job"], "resume_state": run["resume_state"]}
                elif not all(result.get(k) for k in ("session_id", "session_kind", "resume_expires")):
                    resume_error = "Save the exact session_id, session_kind and authorized resume_expires before arming."
                else:
                    import argparse
                    arm_args = argparse.Namespace(run=run_id, provider=cfg["provider"], kind=result["session_kind"],
                        target=result["session_id"], expires=result["resume_expires"], same_account=True,
                        resume_state_dir=Path(cfg.get("resume_state_dir", str(tracker.default_state().parent / "auto-resume"))))
                    try:
                        continuation = tracker.arm(db, latest, state, arm_args)
                    except ValueError as error:
                        resume_error = str(error)
            print(json.dumps({"status": latest["status"], "item": latest["id"], "run_id": run_id,
                              "result": latest["result"], "dispatch_error": failure,
                              "continuation": continuation, "resume_error": resume_error}))
            return 1 if failure else 0
    finally:
        db.close()
