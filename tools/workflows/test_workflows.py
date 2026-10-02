"""End-to-end CLI tests; no network, agent, notifications, or real HOME changes."""
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

CLI = Path(__file__).with_name("workflows.py")
STUB = r'''
import datetime as dt, json, pathlib, sys, time
root = pathlib.Path(sys.argv[1]); role = sys.argv[2]; args = sys.argv[3:]
flags = json.loads((root/'flags.json').read_text())
with (root/'calls').open('a') as f: f.write(role+'\n')
if flags.get(role+'_sleep'): time.sleep(flags[role+'_sleep'])
if flags.get(role+'_fail'): print('stub failure', file=sys.stderr); sys.exit(3)
when = dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')
if role == 'version': print('v0.0.1-nightly')
if role == 'gh':
    if args[0] == 'pr':
        (root/'pr-args.json').write_text(json.dumps(args))
        print(json.dumps([{'number':1,'title':'Remote reconnect','url':'https://example/1','body':'Tailscale connection fix','mergedAt':when,'mergeCommit':{'oid':'abc'}}]))
    elif '/compare/' in args[1]:
        print(json.dumps({'status': 'ahead' if not flags.get('unverified') and (not args[1].endswith('abc...v0.0.1-nightly') or flags.get('already_installed')) else 'diverged', 'total_commits':1,'commits':[{'sha':'def','commit':{'message':'Remote reconnect (#1)'}}]}))
    else:
        for rid, tag in [(2,'v0.0.2-nightly'),(1,'v0.0.1-nightly')]:
            print(json.dumps({'id':rid,'tag_name':tag,'name':tag,'draft':False,'published_at':when,'html_url':'https://example/release/'+str(rid),'body':'Nightly release notes'}))
if role == 'agent':
    prompt = sys.stdin.read()
    (root/'prompt.txt').write_text(prompt)
    if flags.get('malformed'): print('{}')
    elif flags.get('unsupported'): print(json.dumps({'recommendation':'update now','summary':'Update','changes':[{'url':'https://evil','reason':'bad'}]}))
    else: print(json.dumps({'recommendation':'update now','summary':'A shipped reconnect fix helps remote T3 access.','changes':[{'url':'https://example/1','reason':'Remote reconnect fix'}]}))
if role == 'codex':
    (root/'prompt.txt').write_text(sys.stdin.read())
    (root/'codex-args.json').write_text(json.dumps(args))
    output = pathlib.Path(args[args.index('--output-last-message')+1])
    output.write_text(json.dumps({'recommendation':'update now','summary':'A shipped reconnect fix helps remote T3 access.','changes':[{'url':'https://example/1','reason':'Remote reconnect fix'}]}))
    print('CLI diagnostics are not the summary')
if role == 'deliver':
    (root/'delivered.txt').write_text(sys.stdin.read())
'''


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workflow home ")
        self.root = Path(self.temp.name)
        self.stub = self.root / "stub.py"
        self.stub.write_text(STUB)
        self.flags = {}
        self.write_flags()
        self.state = self.root / "state"
        self.cfg = self.root / "config.json"
        config = {"gh_command": self.cmd("gh"), "installed_version_command": self.cmd("version"),
                  "agent_command": self.cmd("agent"), "delivery_command": self.cmd("deliver"),
                  "command_timeout_seconds": 2, "agent_timeout_seconds": 2}
        self.cfg.write_text(json.dumps(config))
        self.env = dict(os.environ, HOME=str(self.root))

    def tearDown(self):
        self.temp.cleanup()

    def cmd(self, role):
        return [sys.executable, str(self.stub), str(self.root), role]

    def write_flags(self):
        (self.root / "flags.json").write_text(json.dumps(self.flags))

    def argv(self, action="run"):
        return [sys.executable, str(CLI), action, "--config", str(self.cfg), "--state-dir", str(self.state)]

    def run_cli(self, action="run", code=0):
        self.write_flags()
        result = subprocess.run(self.argv(action), env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        return json.loads(result.stdout if code == 0 else result.stderr)

    def calls(self, role):
        return (self.root / "calls").read_text().splitlines().count(role)

    def test_new_then_unchanged_and_history(self):
        result = self.run_cli()
        self.assertEqual(result["status"], "succeeded")
        report = Path(result["report"]).read_text()
        self.assertIn("included in published nightly v0.0.2-nightly", report)
        self.assertIn("https://example/1", report)
        pr_args = json.loads((self.root / "pr-args.json").read_text())
        self.assertEqual(pr_args[pr_args.index("--base") + 1], "main")
        prompt = (self.root / "prompt.txt").read_text()
        self.assertIn("installed_to_latest_comparison", prompt)
        self.assertIn("intermediate_release_notes", prompt)
        self.assertEqual(self.run_cli()["status"], "unchanged")
        self.assertEqual(self.calls("agent"), 1)
        self.assertEqual(self.calls("deliver"), 1)
        self.assertEqual(self.run_cli("status")["reported_events"], 2)
        self.assertEqual(len(self.run_cli("history")["runs"]), 2)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        self.assertEqual(Path(result["report"]).stat().st_mode & 0o777, 0o600)

    def test_collection_failure_is_visible_and_retryable(self):
        self.flags["gh_fail"] = True
        self.run_cli(code=1)
        self.assertEqual(self.run_cli("status")["runs"][0]["status"], "collection_failed")
        self.assertFalse((self.root / "prompt.txt").exists())
        self.flags.clear()
        self.assertEqual(self.run_cli()["status"], "succeeded")

    def test_failed_delivery_retries_exact_report_without_agent_or_fetch(self):
        self.flags["deliver_fail"] = True
        self.run_cli(code=1)
        status = self.run_cli("status")
        self.assertTrue(status["pending_delivery"])
        self.assertEqual(status["reported_events"], 0)
        self.assertEqual(status["runs"][0]["status"], "delivery_failed")
        gh_calls = self.calls("gh")
        self.flags.clear()
        self.assertTrue(self.run_cli()["retried_delivery"])
        self.assertEqual(self.calls("gh"), gh_calls)
        self.assertEqual(self.calls("agent"), 1)
        self.assertFalse(self.run_cli("status")["pending_delivery"])

    def test_invalid_agent_outcome_does_not_advance_cursor(self):
        for flag in ("malformed", "unsupported"):
            self.flags = {flag: True}
            self.run_cli(code=1)
            status = self.run_cli("status")
            self.assertEqual(status["runs"][0]["status"], "summary_failed")
            self.assertEqual(status["reported_events"], 0)
        self.flags.clear()
        self.assertEqual(self.run_cli()["status"], "succeeded")

    def test_concurrent_run_does_not_duplicate_agent(self):
        self.flags["agent_sleep"] = 1
        self.write_flags()
        first = subprocess.Popen(self.argv(), env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 5
            while not (self.root / "calls").exists() or "agent" not in (self.root / "calls").read_text():
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            self.assertEqual(self.run_cli()["status"], "busy")
            out, err = first.communicate(timeout=5)
            self.assertEqual(first.returncode, 0, out + err)
            self.assertEqual(self.calls("agent"), 1)
        finally:
            if first.poll() is None:
                first.kill()
                first.wait()

    def test_timeout_is_durable(self):
        config = json.loads(self.cfg.read_text())
        config["agent_timeout_seconds"] = 0.1
        self.cfg.write_text(json.dumps(config))
        self.flags["agent_sleep"] = 1
        result = self.run_cli(code=1)
        self.assertIn("timed out", result["error"])
        self.assertEqual(self.run_cli("status")["runs"][0]["status"], "summary_failed")

    def test_unverified_merges_are_not_labeled_shipped(self):
        self.flags["unverified"] = True
        result = self.run_cli()
        report = Path(result["report"]).read_text()
        self.assertIn("merged; release availability unverified", report)
        self.assertNotIn("included in published nightly", report)

    def test_already_installed_pr_is_explicit(self):
        self.flags["already_installed"] = True
        result = self.run_cli()
        self.assertIn("already included in installed version v0.0.1-nightly", Path(result["report"]).read_text())

    def test_collect_does_not_summarize_or_deliver(self):
        result = self.run_cli("collect")
        self.assertEqual(len(result["events"]), 2)
        self.assertFalse((self.root / "prompt.txt").exists())
        self.assertFalse((self.root / "delivered.txt").exists())

    def test_configured_codex_prefix_keeps_schema_and_read_only_sandbox(self):
        config = json.loads(self.cfg.read_text())
        del config["agent_command"]
        prefix = self.cmd("codex") + ["--model", "gpt-6.1-sol", "-c", 'model_reasoning_effort="medium"']
        config["codex_command"] = prefix
        self.cfg.write_text(json.dumps(config))
        self.assertEqual(self.run_cli()["status"], "succeeded")
        args = json.loads((self.root / "codex-args.json").read_text())
        self.assertEqual(args[:5], prefix[4:] + ["exec"])
        self.assertEqual(args[args.index("--sandbox") + 1], "read-only")
        self.assertIn("--output-schema", args)
        self.assertIn("--ephemeral", args)


if __name__ == "__main__":
    unittest.main()
