"""No live accounts, network calls, provider sessions, or thread mutations."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

TOOL = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("auto_resume", TOOL / "auto_resume.py")
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


def window(label="5h", used=10, reset=None):
    return {"label": label, "used_percent": used, "resets_at": reset}


def usage(windows=None, **extra):
    return [{"provider": "Codex", "ok": True, "stale_at": None,
             "windows": windows if windows is not None else [window()], **extra}]


class QuotaTests(unittest.TestCase):
    def test_all_windows_and_latest_reset_buffer(self):
        payload = usage([window("5h", 100, core.iso(200)), window("week", 105, core.iso(500))])
        self.assertEqual(core.quota(payload, "codex", [], 100, 30), 530)
        self.assertEqual(core.quota(payload, "codex", ["5h"], 100, 0), 200)

    def test_selected_model_bucket(self):
        payload = usage([window("aggregate"), window("model", 100, core.iso(500))])
        self.assertIsNone(core.quota(payload, "codex", ["aggregate"], 100, 30))
        self.assertEqual(core.quota(payload, "codex", [], 100, 30), 530)
        with self.assertRaises(ValueError):
            core.quota(payload, "codex", ["absent"], 100, 30)

    def test_stale_failed_missing_malformed(self):
        cases = [usage(stale_at=core.iso(100)), usage(ok=False), [], {}, usage([]),
                 usage([window(used=None)]), usage([window(used=True)]),
                 usage([window(used=float("nan"))]), usage([window(used=-1)]),
                 usage([window(used=100)]), usage([window(used=100, reset="tomorrow")]),
                 usage([window(), window()]), usage([{"used_percent": 0}])]
        for payload in cases:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                core.quota(payload, "codex", [], 100, 30)

    def test_no_assumed_recovery_after_reset(self):
        with self.assertRaises(ValueError):
            core.quota(usage([window(used=100, reset=core.iso(20))]), "codex", [], 100, 30)

    def test_reserve_waits_like_an_exhausted_window(self):
        payload = usage([window("5h", 89, core.iso(200)), window("week", 95, core.iso(500))])
        self.assertIsNone(core.quota(payload, "codex", [], 100, 30))
        self.assertEqual(core.quota(payload, "codex", [], 100, 30, reserve=10), 530)
        self.assertEqual(core.quota(payload, "codex", [], 100, 30, reserve=11), 530)
        self.assertIsNone(core.quota(payload, "codex", ["5h"], 100, 30, reserve=10))


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="auto-resume-test-")
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.state.mkdir()
        self.cwd = self.root / "project with spaces"
        self.cwd.mkdir()
        self.env = dict(os.environ, HOME=str(self.root), XDG_STATE_HOME=str(self.root / "xdg"))
        for key in ("OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY",
                    "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
                    "CLAUDE_CODE_USE_FOUNDRY", "CURSOR_API_KEY", "CURSOR_API_ENDPOINT"):
            self.env.pop(key, None)
        self.payload = self.root / "usage.json"
        self.payload.write_text(json.dumps(usage()))
        self.record = self.root / "dispatch.jsonl"
        self.usage_command = self.script("fake usage", """
import json, pathlib, sys, time
p = pathlib.Path(__file__).parent
(p / 'usage-args.json').write_text(json.dumps(sys.argv[1:]))
delay = p / 'usage-delay'
if delay.exists():
    (p / 'usage-started').touch()
    time.sleep(float(delay.read_text()))
print((p / 'usage.json').read_text())
""")
        self.provider_command = self.script("fake provider", """
import json, os, pathlib, sys, time
p = pathlib.Path(__file__).parent
with (p / 'dispatch.jsonl').open('a') as f:
    f.write(json.dumps({'argv':sys.argv[1:], 'cwd':os.getcwd()}) + '\\n')
delay = p / 'provider-delay'
if delay.exists(): time.sleep(float(delay.read_text()))
failure = p / 'provider-fail'
sys.exit(int(failure.read_text()) if failure.exists() else 0)
""")
        self.adapter = self.script("fake adapter", """
import json, os, pathlib, sys
p = pathlib.Path(__file__).parent
if sys.argv[1] == 'inspect':
    print((p / 'inspect.json').read_text())
else:
    with (p / 'dispatch.jsonl').open('a') as f:
        f.write(json.dumps({'argv':sys.argv[1:], 'revision':os.environ.get('AUTO_RESUME_EXPECTED_REVISION'), 'job':os.environ.get('AUTO_RESUME_JOB_ID')}) + '\\n')
    print((p / 'resume.json').read_text())
""")
        (self.root / "inspect.json").write_text(json.dumps({"status": "idle", "revision": "rev1"}))
        (self.root / "resume.json").write_text(json.dumps({"accepted": True}))
        self.cfg = {"usage_command": [str(self.usage_command)],
                    "provider_commands": {name: [str(self.provider_command)] for name in core.PROVIDERS},
                    "t3_adapter": [str(self.adapter)], "retry_delay_seconds": 0.01,
                    "check_timeout_seconds": 5, "dispatch_timeout_seconds": 5}
        self.save_config()
        self.target = str(uuid.uuid4())

    def tearDown(self):
        self.temp.cleanup()

    def script(self, name, source):
        path = self.root / name
        path.write_text("#!" + sys.executable + "\n" + source)
        path.chmod(0o700)
        return path

    def save_config(self):
        (self.state / "config.json").write_text(json.dumps(self.cfg))

    def run_cli(self, *args, ok=True):
        result = subprocess.run([sys.executable, str(TOOL / "auto_resume.py"), "--state-dir", str(self.state), *args],
                                env=self.env, capture_output=True, text=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0)
        return result.stderr

    def arm(self, *extra):
        return self.run_cli("arm", "--provider", "codex", "--target", self.target,
                            "--cwd", str(self.cwd), "--expires", core.iso(time.time() + 3600),
                            "--prompt", "Finish the authorized task", "--same-account", *extra)

    def change(self, job_id, **values):
        with sqlite3.connect(self.state / "jobs.sqlite3") as db:
            db.execute("UPDATE jobs SET " + ",".join(key + "=?" for key in values) + " WHERE id=?",
                       list(values.values()) + [job_id])

    def show(self, job):
        return self.run_cli("show", job["id"])

    def test_exact_cli_resume_one_shot_and_private_state(self):
        job = self.arm()
        self.run_cli("tick")
        self.run_cli("tick")
        records = [json.loads(line) for line in self.record.read_text().splitlines()]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["argv"][:3], ["exec", "resume", self.target])
        self.assertEqual(records[0]["cwd"], str(self.cwd.resolve()))
        self.assertIn("asking before git commit", records[0]["argv"][3])
        self.assertNotIn("--last", records[0]["argv"])
        self.assertEqual(self.show(job)["status"], "resumed")
        self.assertEqual(json.loads((self.root / "usage-args.json").read_text()), ["--json", "--only", "codex"])
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.state / "jobs.sqlite3").stat().st_mode & 0o777, 0o600)

    def test_reset_buffer_and_fresh_recheck(self):
        job = self.arm()
        reset = time.time() + 200
        self.payload.write_text(json.dumps(usage([window("5h", 100, core.iso(reset)), window("week", 100, core.iso(reset + 100))])))
        self.run_cli("tick")
        self.assertAlmostEqual(self.show(job)["next_check"], reset + 130, places=4)
        self.payload.write_text(json.dumps(usage()))
        self.run_cli("tick")
        self.assertFalse(self.record.exists())
        self.change(job["id"], next_check=0)
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "resumed")

    def test_reserve_holds_continuation_until_the_window_resets(self):
        job = self.arm("--reserve-percent", "10")
        self.assertEqual(job["reserve"], 10)
        reset = time.time() + 200
        self.payload.write_text(json.dumps(usage([window("5h", 20, core.iso(reset - 100)), window("week", 95, core.iso(reset))])))
        self.run_cli("tick")
        self.assertFalse(self.record.exists())
        self.assertEqual(self.show(job)["status"], "pending")
        self.assertAlmostEqual(self.show(job)["next_check"], reset + 30, places=4)
        self.assertIn("reserve", self.show(job)["message"])
        self.run_cli("arm", "--provider", "codex", "--target", str(uuid.uuid4()), "--cwd", str(self.cwd),
                     "--expires", core.iso(time.time() + 3600), "--prompt", "x", "--same-account",
                     "--reserve-percent", "100", ok=False)

    def test_jobs_armed_before_the_reserve_existed_still_dispatch(self):
        with sqlite3.connect(self.state / "jobs.sqlite3") as db:
            db.execute("""CREATE TABLE jobs (
                id TEXT PRIMARY KEY, provider TEXT NOT NULL, kind TEXT NOT NULL,
                target TEXT NOT NULL, cwd TEXT NOT NULL, prompt TEXT NOT NULL,
                expires REAL NOT NULL, buffer INTEGER NOT NULL, windows TEXT NOT NULL,
                max_retries INTEGER NOT NULL, max_attempts INTEGER NOT NULL,
                retries INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
                revision TEXT, status TEXT NOT NULL, next_check REAL NOT NULL,
                created REAL NOT NULL, updated REAL NOT NULL, message TEXT NOT NULL)""")
            now = time.time()
            db.execute("""INSERT INTO jobs(id,provider,kind,target,cwd,prompt,expires,buffer,windows,max_retries,
                max_attempts,status,next_check,created,updated,message) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                ("old", "codex", "cli", self.target, str(self.cwd.resolve()), "Finish", now + 3600, 30, "[]", 3, 3,
                 "pending", now, now, now, "armed"))
        self.run_cli("tick")
        self.assertEqual(self.run_cli("show", "old")["status"], "resumed")
        self.assertEqual(self.run_cli("show", "old")["reserve"], 0)

    def test_stale_bounded_retries(self):
        job = self.arm("--max-retries", "1")
        self.payload.write_text(json.dumps(usage(stale_at=core.iso(time.time()))))
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "pending")
        self.change(job["id"], next_check=0)
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "failed")
        self.assertFalse(self.record.exists())

    def test_failed_usage_command(self):
        self.cfg["usage_command"] = [str(self.root / "missing")]
        self.save_config()
        job = self.arm("--max-retries", "0")
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "failed")

    def test_expiry_and_cancellation(self):
        job = self.arm()
        self.change(job["id"], expires=0, next_check=time.time() + 9999)
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "expired")
        job = self.arm()
        self.run_cli("cancel", job["id"])
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "cancelled")
        self.assertFalse(self.record.exists())

    def test_duplicate_target_and_invalid_ids(self):
        self.arm()
        self.assertIn("UNIQUE", self.run_cli("arm", "--provider", "codex", "--target", self.target,
                      "--cwd", str(self.cwd), "--expires", core.iso(time.time() + 200),
                      "--prompt", "Continue", "--same-account", ok=False))
        self.target = "session-name"
        with self.assertRaises(AssertionError):
            self.arm()

    def test_t3_exact_thread_and_revision(self):
        self.target = "thread-exact-42"
        job = self.arm("--kind", "t3")
        self.run_cli("tick")
        record = json.loads(self.record.read_text())
        self.assertEqual(record["argv"][:2], ["resume", self.target])
        self.assertEqual(record["revision"], "rev1")
        self.assertEqual(record["job"], job["id"])
        self.assertEqual(self.show(job)["status"], "resumed")

    def test_t3_changed_busy_completed_blocked_cancelled(self):
        for status, revision in [("idle", "changed"), ("running", "rev1"),
                                 ("completed", "rev1"), ("blocked", "rev1"), ("cancelled", "rev1")]:
            with self.subTest(status=status):
                (self.root / "inspect.json").write_text(json.dumps({"status": "idle", "revision": "rev1"}))
                self.target = "thread-" + str(uuid.uuid4())
                job = self.arm("--kind", "t3")
                (self.root / "inspect.json").write_text(json.dumps({"status": status, "revision": revision}))
                self.run_cli("tick")
                self.assertEqual(self.show(job)["status"], "needs_review")
        self.assertFalse(self.record.exists())

    def test_t3_rejected_and_explicit_safe_retry(self):
        job = self.arm("--kind", "t3")
        (self.root / "resume.json").write_text(json.dumps({"accepted": False, "not_sent": True, "retryable": True}))
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "pending")
        self.change(job["id"], next_check=0)
        (self.root / "resume.json").write_text(json.dumps({"accepted": False}))
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "needs_review")

    def test_t3_attempt_budget(self):
        job = self.arm("--kind", "t3", "--max-attempts", "1")
        (self.root / "resume.json").write_text(json.dumps({"accepted": False, "not_sent": True, "retryable": True}))
        self.run_cli("tick")
        self.change(job["id"], next_check=0)
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "failed")
        self.assertEqual(len(self.record.read_text().splitlines()), 1)

    def test_provider_failure_is_uncertain_not_blindly_replayed(self):
        job = self.arm()
        (self.root / "provider-fail").write_text("2")
        self.run_cli("tick")
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "needs_review")
        self.assertEqual(len(self.record.read_text().splitlines()), 1)

    def test_missing_executable_retries_bounded(self):
        self.cfg["provider_commands"]["codex"] = [str(self.root / "absent")]
        self.save_config()
        job = self.arm("--max-retries", "0")
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "failed")
        self.assertEqual(self.show(job)["attempts"], 1)

    def test_crashed_dispatch_needs_review(self):
        job = self.arm()
        self.change(job["id"], status="dispatching")
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "needs_review")
        self.assertFalse(self.record.exists())

    def start_tick(self):
        return subprocess.Popen([sys.executable, str(TOOL / "auto_resume.py"), "--state-dir", str(self.state), "tick"],
                                env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def await_file(self, name):
        limit = time.time() + 4
        while not (self.root / name).exists() and time.time() < limit:
            time.sleep(0.01)
        self.assertTrue((self.root / name).exists())

    def test_concurrent_ticks_and_cancel_during_check(self):
        job = self.arm()
        (self.root / "usage-delay").write_text("0.5")
        first = self.start_tick()
        self.await_file("usage-started")
        self.assertEqual(self.run_cli("tick")["status"], "busy")
        self.assertEqual(self.run_cli("cancel", job["id"])["status"], "cancelled")
        out, err = first.communicate(timeout=10)
        self.assertEqual(first.returncode, 0, err)
        self.assertFalse(self.record.exists())

    def test_concurrent_ticks_dispatch_once_and_active_cancel_honest(self):
        job = self.arm()
        (self.root / "provider-delay").write_text("0.5")
        first = self.start_tick()
        self.await_file("dispatch.jsonl")
        self.assertEqual(self.run_cli("tick")["status"], "busy")
        self.assertIn("cannot withdraw", self.run_cli("cancel", job["id"], ok=False))
        _, err = first.communicate(timeout=10)
        self.assertEqual(first.returncode, 0, err)
        self.assertEqual(len(self.record.read_text().splitlines()), 1)

    def test_api_env_and_missing_same_account_refused(self):
        self.env["OPENAI_API_KEY"] = "fake-no-live-credential"
        with self.assertRaises(AssertionError):
            self.arm()
        self.assertFalse(self.record.exists())
        self.env.pop("OPENAI_API_KEY")
        error = self.run_cli("arm", "--provider", "codex", "--target", self.target,
                             "--cwd", str(self.cwd), "--expires", core.iso(time.time() + 300),
                             "--prompt", "Continue", ok=False)
        self.assertIn("--same-account is required", error)

    def test_claude_cursor_exact_dispatch(self):
        for provider, label in [("claude", "Claude Code"), ("cursor", "Cursor")]:
            with self.subTest(provider=provider):
                target = str(uuid.uuid4())
                job = self.run_cli("arm", "--provider", provider, "--target", target,
                                   "--cwd", str(self.cwd), "--expires", core.iso(time.time() + 300),
                                   "--prompt", "Continue", "--same-account")
                self.payload.write_text(json.dumps([{"provider": label, "ok": True,
                                                       "stale_at": None, "windows": [window()]}]))
                self.run_cli("tick")
                record = json.loads(self.record.read_text().splitlines()[-1])
                self.assertEqual(record["argv"][:3], ["--print", "--resume", target])
                self.assertEqual(self.show(job)["status"], "resumed")

    def test_t3_unsupported_refuses_arming(self):
        (self.root / "inspect.json").write_text(json.dumps({"status": "idle", "revision": "rev1",
                                                              "resume_supported": False, "reason": "atomic guard unavailable"}))
        with self.assertRaises(AssertionError):
            self.arm("--kind", "t3")
        self.assertEqual(self.run_cli("list"), [])

    def test_timeout_kills_provider_children_and_requires_review(self):
        marker = self.root / "child-survived"
        slow = self.script("slow provider", """
import pathlib, subprocess, sys, time
p = pathlib.Path(__file__).parent
code = 'import pathlib,time; time.sleep(0.8); pathlib.Path(' + repr(str(p / 'child-survived')) + ').touch()'
subprocess.Popen([sys.executable, '-c', code])
time.sleep(5)
""")
        self.cfg["provider_commands"]["codex"] = [str(slow)]
        self.cfg["dispatch_timeout_seconds"] = 0.1
        self.save_config()
        job = self.arm()
        self.run_cli("tick")
        self.assertEqual(self.show(job)["status"], "needs_review")
        time.sleep(0.9)
        self.assertFalse(marker.exists())

    def test_invalid_configuration_and_buffer(self):
        self.cfg["provider_commands"] = []
        self.save_config()
        self.assertIn("must be an object", self.run_cli("tick", ok=False))
        self.cfg["provider_commands"] = {name: [str(self.provider_command)] for name in core.PROVIDERS}
        self.save_config()
        with self.assertRaises(AssertionError):
            self.arm("--buffer", "61")


if __name__ == "__main__":
    unittest.main()
