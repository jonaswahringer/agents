#!/usr/bin/env python3
"""Regression tests for cached Claude quota displays."""

import datetime as dt
import importlib.util
import json
import os
import tempfile
import unittest
from importlib.machinery import SourceFileLoader
from unittest import mock


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "bin", "usage")


def load_usage():
    loader = SourceFileLoader("usage_under_test", SOURCE)
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


RESPONSE = {
    "limits": [
        {
            "kind": "session",
            "percent": 65,
            "resets_at": "2026-08-08T10:00:00+00:00",
            "scope": None,
        },
    ],
}
OAUTH = {"accessToken": "test-token", "rateLimitTier": "default_claude_max_5x"}


class ClaudeLoginRenewalTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        os.makedirs(os.path.join(self.home.name, ".claude"))
        environ = mock.patch.dict(os.environ, {"HOME": self.home.name, "USER": "tester"}, clear=False)
        environ.start()
        self.addCleanup(environ.stop)
        os.environ.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
        self.usage = load_usage()
        self.keychain = None
        self.security_calls = []
        run = mock.patch.object(self.usage.subprocess, "run", side_effect=self.fake_security)
        run.start()
        self.addCleanup(run.stop)
        self.post = mock.patch.object(self.usage, "post_json", return_value={
            "access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 3600,
            "scope": "user:profile user:inference",
        })
        self.post_json = self.post.start()
        self.addCleanup(self.post.stop)

    def fake_security(self, command, **kwargs):
        self.security_calls.append((command, kwargs.get("input")))
        if command[1] == "find-generic-password":
            if self.keychain is None:
                return mock.Mock(returncode=44, stdout="", stderr="")
            if "-w" not in command:
                return mock.Mock(returncode=0, stdout='    "acct"<blob>="keychain-owner"\n', stderr="")
            return mock.Mock(returncode=0, stdout=json.dumps(self.keychain), stderr="")
        return mock.Mock(returncode=0, stdout="", stderr="")

    def path(self, name):
        return os.path.join(self.home.name, ".claude", name)

    def write(self, name, data):
        with open(self.path(name), "w") as f:
            json.dump(data, f)

    def expired_login(self):
        return {"accessToken": "old-access", "refreshToken": "old-refresh", "expiresAt": 1,
                "scopes": ["user:profile", "user:inference"], **OAUTH}

    def test_valid_login_is_used_without_renewing(self):
        future = int((dt.datetime.now().timestamp() + 3600) * 1000)
        self.write(".credentials.json", {"claudeAiOauth": {**OAUTH, "expiresAt": future}})
        self.assertEqual(self.usage.claude_oauth()["accessToken"], "test-token")
        self.post_json.assert_not_called()

    def test_expired_file_login_is_renewed_and_saved(self):
        self.write(".credentials.json", {"claudeAiOauth": self.expired_login()})
        oauth = self.usage.claude_oauth()
        self.assertEqual(oauth["accessToken"], "new-access")
        self.assertEqual(self.usage.claude_plan(oauth), "max5")
        body = self.post_json.call_args.args[1]
        self.assertEqual(body["refresh_token"], "old-refresh")
        self.assertEqual(body["scope"], "user:profile user:inference")
        with open(self.path(".credentials.json")) as f:
            saved = json.load(f)["claudeAiOauth"]
        self.assertEqual(saved["refreshToken"], "new-refresh")
        self.assertGreater(saved["expiresAt"], dt.datetime.now().timestamp() * 1000)
        self.assertFalse(os.path.exists(self.path(".oauth_refresh.lock")))
        self.assertFalse(os.path.exists(self.home.name + "/.claude.lock"))

    def test_expired_keychain_login_is_saved_back_through_stdin(self):
        self.keychain = {"claudeAiOauth": self.expired_login(), "designOauth": {"keep": True}}
        self.usage.claude_oauth()
        command, stdin = self.security_calls[-1]
        self.assertEqual(command, ["security", "-i"])
        self.assertNotIn("new-refresh", stdin)
        hexed = stdin.split('-X "')[1].split('"')[0]
        saved = json.loads(bytes.fromhex(hexed))
        self.assertEqual(saved["claudeAiOauth"]["refreshToken"], "new-refresh")
        self.assertEqual(saved["designOauth"], {"keep": True})
        self.assertIn('-a "keychain-owner" -s "Claude Code-credentials"', stdin)

    def test_stale_lock_left_by_a_dead_process_is_taken_over(self):
        self.write(".credentials.json", {"claudeAiOauth": self.expired_login()})
        lock = self.path(".oauth_refresh.lock")
        os.mkdir(lock)
        os.utime(lock, (1, 1))
        self.assertEqual(self.usage.claude_oauth()["accessToken"], "new-access")

    def test_failed_renewal_explains_what_to_do(self):
        self.write("settings.json", {"env": {"CLAUDE_CODE_OAUTH_TOKEN": "long-lived"}})
        self.write(".credentials.json", {"claudeAiOauth": self.expired_login()})
        self.post_json.side_effect = self.usage.Unavailable("HTTP 400: invalid_grant")
        with self.assertRaises(self.usage.Unavailable) as caught:
            self.usage.claude_oauth()
        message = str(caught.exception)
        self.assertIn("invalid_grant", message)
        self.assertIn("claude auth login", message)
        self.assertIn("long-lived tokens cannot read quotas", message)
        self.assertEqual(caught.exception.plan, "max5")


class ClaudeCacheTests(unittest.TestCase):
    def setUp(self):
        self.cache = tempfile.TemporaryDirectory()
        self.environ = mock.patch.dict(os.environ, {"XDG_CACHE_HOME": self.cache.name}, clear=False)
        self.environ.start()
        self.usage = load_usage()
        self.oauth = mock.patch.object(self.usage, "claude_oauth", return_value=OAUTH)
        self.oauth.start()
        self.addCleanup(self.oauth.stop)
        self.addCleanup(self.environ.stop)
        self.addCleanup(self.cache.cleanup)

    def test_429_keeps_last_snapshot_and_persists_deadline(self):
        with mock.patch.object(self.usage, "get_json", return_value=RESPONSE):
            fresh = self.usage.claude_usage()
        self.assertIsNone(fresh.get("stale_at"))

        self.usage._claude_cooldown_until = 0
        with mock.patch.object(
            self.usage,
            "get_json",
            side_effect=self.usage.Unavailable("HTTP 429", retry_after=2330),
        ):
            stale = self.usage.claude_usage()

        self.assertEqual(stale["windows"][0].percent, 65)
        self.assertEqual(stale["notice"], "usage check rate-limited; server requested retry in 39m")
        self.assertIsNotNone(stale["stale_at"])
        with open(self.usage.claude_cache_path()) as f:
            cache = json.load(f)
        self.assertIn("retry_at", cache)

    def test_persisted_deadline_blocks_request_after_restart(self):
        self.usage.save_claude_cache({
            "version": 1,
            "fetched_at": dt.datetime.now().astimezone().isoformat(),
            "retry_at": (dt.datetime.now().astimezone() + dt.timedelta(minutes=39)).isoformat(),
            "windows": [{
                "label": "5-hour session",
                "used_percent": 65,
                "remaining_percent": 35,
                "used_dollars": None,
                "limit_dollars": None,
                "resets_at": "2026-08-08T10:00:00+00:00",
            }],
        })
        with mock.patch.object(self.usage, "get_json") as get_json:
            stale = self.usage.claude_usage()

        get_json.assert_not_called()
        self.assertTrue(stale["notice"].startswith("usage check rate-limited; server requested retry in"))
        result = self.usage.run_provider("Claude Code", lambda: stale)
        lines = self.usage.provider_lines("Claude Code", result, " ", 20)
        self.assertIn("  stale — last confirmed <1m ago", lines)
        self.assertTrue(any("server requested retry" in line for line in lines))

    def test_live_polling_interval_is_three_minutes(self):
        self.assertEqual(self.usage.STREAM_SECONDS, 180)


if __name__ == "__main__":
    unittest.main()
