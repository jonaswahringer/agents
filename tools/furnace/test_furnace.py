"""Tracker CLI and private-state checks; no provider or GitHub calls."""
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


class FurnaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="furnace home ")
        self.home = Path(self.temp.name)
        self.state = self.home / "state"
        self.repo = self.home / "project with spaces"
        self.repo.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), XDG_STATE_HOME=str(self.home / "default state"))

    def tearDown(self):
        self.temp.cleanup()

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

    def test_waiting_checkpoint_and_fresh_claim_keep_session_ownership(self):
        ready = self.ready()
        first = self.command("claim", ready["id"], "--owner", "T3 thread one")
        self.checkpoint(first, "waiting_quota", summary="Provider limit reached", session_id="thread-one", session_kind="t3")
        self.assertEqual(self.command("claim", "--owner", "another thread")["status"], "idle")
        self.checkpoint(first, "blocked", summary="Checkpoint for a later run")
        self.command("edit", ready["id"], "--status", "ready")
        second = self.command("claim", ready["id"], "--owner", "T3 thread two")
        self.assertNotEqual(first["run_id"], second["run_id"])
        self.assertNotIn("session_id", second["result"])
        self.assertNotIn("session_kind", second["result"])
        self.assertEqual(second["result"]["summary"], "Checkpoint for a later run")

    def test_existing_legacy_continuation_must_be_terminal_before_clearing(self):
        current = self.command("claim", self.ready()["id"], "--owner", "legacy owner")
        self.checkpoint(current, "waiting_quota", summary="Existing continuation")
        queue = self.home / "legacy queue"
        queue.mkdir()
        with sqlite3.connect(queue / "jobs.sqlite3") as db:
            db.execute("CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT)")
            db.execute("INSERT INTO jobs VALUES ('old-job', 'pending')")
        with sqlite3.connect(self.state / "furnace.sqlite3") as db:
            db.execute("UPDATE runs SET resume_job='old-job',resume_state=? WHERE id=?", (str(queue), current["run_id"]))
        self.assertIn("pending continuation", self.checkpoint_error(current, "ready"))
        args = ["clear-resume", current["id"], "--run", current["run_id"]]
        self.assertIn("--reviewed", self.command(*args, ok=False))
        self.assertIn("active continuation", self.command(*args, "--reviewed", ok=False))
        with sqlite3.connect(queue / "jobs.sqlite3") as db:
            db.execute("UPDATE jobs SET status='cancelled'")
        self.command(*args, "--reviewed")
        result = self.checkpoint(current, "ready", summary="Legacy continuation was cancelled")
        self.assertEqual(result["status"], "ready")
        with sqlite3.connect(queue / "jobs.sqlite3") as db:
            self.assertEqual(db.execute("SELECT status FROM jobs").fetchone()[0], "cancelled")

    def checkpoint_error(self, item, status):
        path = self.home / "blocked-checkpoint.json"
        path.write_text(json.dumps({"summary": "Attempted transition"}))
        return self.command("checkpoint", item["id"], "--run", item["run_id"], "--status", status, "--file", str(path), ok=False)


if __name__ == "__main__":
    unittest.main()
