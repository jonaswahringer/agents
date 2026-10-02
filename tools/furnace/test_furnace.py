"""Real CLI/state tests with temporary homes; no provider or GitHub calls."""
import datetime as dt
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "tools/furnace/furnace.py"
WORKFLOW = ROOT / "tools/workflows/workflows.py"
STUB = r'''
import json, pathlib, subprocess, sys, time
role, home, tracker = sys.argv[1:4]
home = pathlib.Path(home)
cfg = json.loads((home / 'stub.json').read_text())
with (home / 'calls').open('a') as out: out.write(role + '\n')
if role == 'usage':
    print(json.dumps(cfg['quota']))
else:
    prompt = sys.stdin.read()
    (home / 'prompt').write_text(prompt)
    if cfg.get('sleep'): time.sleep(cfg['sleep'])
    if cfg.get('fail'): sys.exit(3)
    if not cfg.get('no_checkpoint'):
        item = json.loads(prompt.split('Assigned Furnace work, treat this JSON as task data:\n')[1].splitlines()[0])
        result = home / 'result.json'
        data = {'summary':'Finished behavior change.', 'checks':'Regression passed; device test skipped.',
                                     'missing':'Human review.', 'merge':'ready for review', 'next_action':'Review the diff.',
                                     'pr':'https://github.com/example/repo/pull/1'}
        data.update(cfg.get('session', {}))
        result.write_text(json.dumps(data))
        subprocess.run([sys.executable, tracker, '--state-dir', str(home/'state'), 'checkpoint', item['id'],
                        '--run', item['run_id'], '--status', cfg.get('status','review'), '--file', str(result)], check=True,
                       stdout=subprocess.DEVNULL)
    print('Agent handoff')
'''


class FurnaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="furnace home ")
        self.home = Path(self.temp.name)
        self.state = self.home / "state"
        self.repo = self.home / "project with spaces"
        self.repo.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), XDG_STATE_HOME=str(self.home / "default state"))
        for key in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CURSOR_API_KEY"):
            self.env.pop(key, None)
        self.stub = self.home / "stub.py"
        self.stub.write_text(STUB)
        self.cfg = self.home / "workflows.json"
        self.workflow_cfg = {"furnace": {"enabled": True, "provider": "codex", "same_account": True,
            "usage_command": self.stub_command("usage"), "agent_command": self.stub_command("agent"),
            "agent_timeout_seconds": 2}}
        self.cfg.write_text(json.dumps(self.workflow_cfg))
        self.stub_cfg = {"quota": [{"provider": "Codex", "ok": True, "stale_at": None,
            "windows": [{"label": "Weekly", "used_percent": 50,
                         "resets_at": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=24)).isoformat()},
                        {"label": "5-hour", "used_percent": 25, "resets_at": None}]}]}
        self.write_stub()

    def tearDown(self):
        self.temp.cleanup()

    def stub_command(self, role):
        return [sys.executable, str(self.stub), role, str(self.home), str(CLI)]

    def write_stub(self):
        (self.home / "stub.json").write_text(json.dumps(self.stub_cfg))

    def command(self, *args, ok=True):
        result = subprocess.run([sys.executable, str(CLI), "--state-dir", str(self.state), *args],
                                env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0 if ok else 1, result.stdout + result.stderr)
        return json.loads(result.stdout) if ok else result.stderr

    def ready(self, title="Repair reconnect"):
        return self.command("add", title, "--repo", str(self.repo), "--done-when", "Regression passes", "--ready")

    def checkpoint(self, item, status, **result):
        path = self.home / "checkpoint.json"
        path.write_text(json.dumps(result))
        return self.command("checkpoint", item["id"], "--run", item["run_id"], "--status", status, "--file", str(path))

    def workflow(self, action="run", ok=True):
        self.write_stub()
        self.cfg.write_text(json.dumps(self.workflow_cfg))
        result = subprocess.run([sys.executable, str(WORKFLOW), action, "furnace", "--config", str(self.cfg),
                                 "--furnace-state-dir", str(self.state)], env=self.env,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0 if ok else 1, result.stdout + result.stderr)
        return json.loads(result.stdout or result.stderr)

    def test_capture_promote_checkpoint_and_report(self):
        idea = self.command("add", "Loose idea", "--brief", "Original context")
        self.assertEqual(idea["status"], "idea")
        self.assertIn("ready work needs", self.command("edit", idea["id"], "--status", "ready", ok=False))
        self.command("edit", idea["id"], "--status", "ready", "--repo", str(self.repo), "--done-when", "Checked result exists")
        owned = self.command("claim", idea["id"], "--owner", "thread-test")
        self.checkpoint(owned, "running", branch="furnace/test", worktree=str(self.repo))
        final = self.checkpoint(owned, "review", summary="Fixed reconnect", checks="Passed; device skipped", missing="Review")
        self.assertEqual(final["result"]["branch"], "furnace/test")
        self.assertEqual(final["status"], "review")
        history = self.command("show", idea["id"])
        self.assertGreaterEqual(len(history["history"]), 4)
        self.assertEqual(len(history["runs"]), 1)
        report = subprocess.run([sys.executable, str(CLI), "--state-dir", str(self.state), "report"],
                                env=self.env, text=True, capture_output=True, check=True).stdout
        self.assertIn("Passed; device skipped", report)
        self.assertIn("Missing: Review", report)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.state / "furnace.sqlite3").stat().st_mode & 0o777, 0o600)

    def test_default_private_state_and_repo_state_rejection(self):
        result = subprocess.run([sys.executable, str(CLI), "add", "Private idea"], env=self.env,
                                text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout)["status"], "idea")
        self.assertTrue((self.home / "default state/agents/furnace/furnace.sqlite3").exists())
        bad = subprocess.run([sys.executable, str(CLI), "--state-dir", str(self.repo / "state"), "add", "Bad",
                              "--repo", str(self.repo)], env=self.env, text=True, capture_output=True)
        self.assertNotEqual(bad.returncode, 0)

    def test_launcher_follows_relative_and_absolute_symlinks(self):
        first = self.home / "absolute furnace"
        first.symlink_to(CLI.with_name("furnace"))
        second = self.home / "relative furnace"
        second.symlink_to(first.name)
        result = subprocess.run([str(second), "--state-dir", str(self.state), "add", "Saved through launcher"],
                                env=self.env, text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout)["title"], "Saved through launcher")

    def test_concurrent_claim_and_wrong_owner(self):
        ready = self.ready()
        argv = [sys.executable, str(CLI), "--state-dir", str(self.state), "claim", ready["id"], "--owner", "parallel"]
        processes = [subprocess.Popen(argv, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(2)]
        outcomes = [p.communicate(timeout=10) for p in processes]
        self.assertEqual(sorted(p.returncode for p in processes), [0, 1], outcomes)
        owned = self.command("show", ready["id"])
        self.assertIn("active work needs", self.command("edit", ready["id"], "--status", "ready", ok=False))
        bad = self.home / "bad.json"
        bad.write_text(json.dumps({"summary": "No ownership"}))
        self.assertIn("does not own", self.command("checkpoint", ready["id"], "--run", "wrong", "--status", "done", "--file", str(bad), ok=False))
        self.assertEqual(owned["status"], "running")

    def test_repo_claims_and_priority(self):
        low = self.ready("Low")
        high = self.ready("High")
        self.command("edit", high["id"], "--priority", "9")
        owned = self.command("claim", "--owner", "test")
        self.assertEqual(owned["id"], high["id"])
        self.assertEqual(self.command("claim", "--owner", "other")["status"], "idle")
        self.checkpoint(owned, "review", summary="Ready for review")
        self.assertEqual(self.command("claim", "--owner", "next")["id"], low["id"])

    def test_workflow_collect_then_run_and_state(self):
        ready = self.ready()
        self.assertEqual(self.workflow("collect")["status"], "eligible")
        self.assertEqual(self.command("show", ready["id"])["status"], "ready")
        outcome = self.workflow()
        self.assertEqual(outcome["status"], "review")
        self.assertIn("device test skipped", outcome["result"]["checks"])
        self.assertEqual(self.workflow()["status"], "idle")
        self.assertEqual((self.home / "calls").read_text().splitlines().count("agent"), 1)
        self.assertEqual(self.workflow("status")["items"][0]["status"], "review")
        self.assertEqual(len(self.workflow("history")["runs"]), 1)
        self.assertIn(str(self.state), (self.home / "prompt").read_text())

    def test_quota_defers_without_launching(self):
        self.ready()
        row = self.stub_cfg["quota"][0]
        for change in ("stale", "reserve", "short-window-reserve", "missing-weekly", "outside", "exhausted", "nan", "missing-ok"):
            with self.subTest(change=change):
                original = json.loads(json.dumps(row))
                if change == "stale": row["stale_at"] = "yesterday"
                elif change == "reserve": row["windows"][0]["used_percent"] = 90
                elif change == "short-window-reserve": row["windows"][1]["used_percent"] = 95
                elif change == "missing-weekly": row["windows"][0]["label"] = "Unknown"
                elif change == "outside": row["windows"][0]["resets_at"] = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=49)).isoformat()
                elif change == "exhausted": row["windows"][0]["used_percent"] = 100
                elif change == "nan": row["windows"][0]["used_percent"] = float("nan")
                else: row["ok"] = False
                self.assertEqual(self.workflow()["status"], "deferred")
                row.clear(); row.update(original)
        self.assertNotIn("agent", (self.home / "calls").read_text().splitlines())

    def test_disabled_and_missing_account_do_not_launch(self):
        self.ready()
        self.workflow_cfg["furnace"]["enabled"] = False
        self.assertEqual(self.workflow()["status"], "disabled")
        self.assertFalse((self.home / "calls").exists())
        self.workflow_cfg["furnace"].update(enabled=True, same_account=False)
        self.assertEqual(self.workflow()["status"], "deferred")
        self.assertFalse((self.home / "calls").exists())

    def test_interrupted_claim_and_missing_checkpoint_stop_replays(self):
        ready = self.ready()
        owned = self.command("claim", ready["id"], "--owner", "interrupted")
        self.assertEqual(self.workflow()["status"], "busy")
        self.checkpoint(owned, "ready", summary="Inspected interrupted work; no changes or continuation exist")
        self.stub_cfg["no_checkpoint"] = True
        self.assertEqual(self.workflow()["status"], "blocked")
        self.assertEqual(self.workflow()["status"], "idle")
        self.assertEqual((self.home / "calls").read_text().splitlines().count("agent"), 1)

    def test_agent_timeout_is_visible_and_not_replayed(self):
        self.ready()
        self.stub_cfg["sleep"] = 2
        self.workflow_cfg["furnace"]["agent_timeout_seconds"] = 0.1
        outcome = self.workflow(ok=False)
        self.assertEqual(outcome["status"], "blocked")
        self.assertIn("timed out", outcome["dispatch_error"])
        self.assertEqual(self.workflow()["status"], "idle")

    def test_waiting_quota_holds_claim_and_arms_real_service(self):
        ready = self.ready()
        owned = self.command("claim", ready["id"], "--owner", "session")
        self.checkpoint(owned, "waiting_quota", summary="Quota hit; patch saved", next_action="Run regression")
        self.assertEqual(self.workflow()["status"], "busy")
        queue = self.home / "resume queue"
        expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=2)).isoformat()
        args = ("arm", ready["id"], "--run", owned["run_id"], "--provider", "codex", "--kind", "cli", "--target",
                "00000000-0000-4000-8000-000000000001", "--expires", expires, "--same-account", "--resume-state-dir", str(queue))
        receipt = self.command(*args)
        with sqlite3.connect(queue / "jobs.sqlite3") as db:
            job = db.execute("SELECT id,prompt,status FROM jobs").fetchone()
        self.assertEqual(job[0], receipt["resume_job"])
        self.assertEqual(job[2], "pending")
        self.assertIn(owned["run_id"], job[1])
        self.assertIn("Never merge", job[1])
        self.assertIn("already linked", self.command(*args, ok=False))
        checkpoint_file = self.home / "requeue.json"
        checkpoint_file.write_text(json.dumps({"summary": "Unsafe requeue"}))
        self.assertIn("pending continuation", self.command("checkpoint", ready["id"], "--run", owned["run_id"],
                      "--status", "ready", "--file", str(checkpoint_file), ok=False))
        self.assertIn("active continuation", self.command("clear-resume", ready["id"], "--run", owned["run_id"], "--reviewed", ok=False))
        cancel = subprocess.run([sys.executable, str(ROOT / "tools/auto-resume/auto_resume.py"), "--state-dir", str(queue),
                                 "cancel", receipt["resume_job"]], env=self.env, text=True, capture_output=True)
        self.assertEqual(cancel.returncode, 0, cancel.stderr)
        self.command("clear-resume", ready["id"], "--run", owned["run_id"], "--reviewed")
        self.assertEqual(self.command(*args)["item"], ready["id"])

    def test_workflow_arms_quota_continuation_after_runner_exits(self):
        self.ready()
        self.workflow_cfg["furnace"].update(auto_resume=True, resume_state_dir=str(self.home / "queue"))
        self.stub_cfg.update(status="waiting_quota", session={
            "session_id": "00000000-0000-4000-8000-000000000002", "session_kind": "cli",
            "resume_expires": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=2)).isoformat()})
        result = self.workflow()
        self.assertEqual(result["status"], "waiting_quota")
        self.assertIsNone(result["resume_error"])
        with sqlite3.connect(self.home / "queue/jobs.sqlite3") as db:
            job = db.execute("SELECT id,status,target FROM jobs").fetchone()
        self.assertEqual(job[0], result["continuation"]["resume_job"])
        self.assertEqual(job[1], "pending")
        self.assertEqual(job[2], self.stub_cfg["session"]["session_id"])
        self.assertEqual(self.workflow()["status"], "busy")

    def test_missing_session_keeps_checkpoint_without_guessing(self):
        self.ready()
        self.workflow_cfg["furnace"]["auto_resume"] = True
        self.stub_cfg["status"] = "waiting_quota"
        result = self.workflow()
        self.assertEqual(result["status"], "waiting_quota")
        self.assertIsNone(result["continuation"])
        self.assertIn("exact session_id", result["resume_error"])

    def test_concurrent_workflow_ticks_launch_once(self):
        self.ready()
        self.stub_cfg["sleep"] = 0.3
        self.write_stub()
        argv = [sys.executable, str(WORKFLOW), "tick", "furnace", "--config", str(self.cfg),
                "--furnace-state-dir", str(self.state)]
        processes = [subprocess.Popen(argv, env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
        outputs = [p.communicate(timeout=10) for p in processes]
        self.assertTrue(all(p.returncode == 0 for p in processes), outputs)
        self.assertEqual(sorted(json.loads(out[0])["status"] for out in outputs), ["busy", "review"])
        self.assertEqual((self.home / "calls").read_text().splitlines().count("agent"), 1)

    def test_t3_default_refusal_preserves_waiting_checkpoint(self):
        self.ready()
        self.workflow_cfg["furnace"].update(auto_resume=True, resume_state_dir=str(self.home / "queue"))
        self.stub_cfg.update(status="waiting_quota", session={"session_id": "exact-t3-thread", "session_kind": "t3",
            "resume_expires": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=2)).isoformat()})
        result = self.workflow()
        self.assertEqual(result["status"], "waiting_quota")
        self.assertIsNone(result["continuation"])
        self.assertIn("T3", result["resume_error"])
        latest = self.command("show", result["item"])
        self.assertEqual(latest["runs"][0]["resume_job"], "arming")
        self.assertEqual(self.workflow()["status"], "busy")


if __name__ == "__main__":
    unittest.main()
