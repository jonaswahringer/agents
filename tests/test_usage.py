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


class ClaudeLongLivedTokenTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        os.makedirs(os.path.join(self.home.name, ".claude"))
        environ = mock.patch.dict(os.environ, {"HOME": self.home.name}, clear=False)
        environ.start()
        self.addCleanup(environ.stop)
        os.environ.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
        self.usage = load_usage()
        keychain = mock.patch.object(self.usage.subprocess, "run",
                                     return_value=mock.Mock(returncode=44, stdout=""))
        keychain.start()
        self.addCleanup(keychain.stop)

    def write(self, name, data):
        with open(os.path.join(self.home.name, ".claude", name), "w") as f:
            json.dump(data, f)

    def test_settings_token_beats_expired_login_and_keeps_its_plan(self):
        self.write("settings.json", {"env": {"CLAUDE_CODE_OAUTH_TOKEN": "long-lived"}})
        self.write(".credentials.json", {"claudeAiOauth": {"accessToken": "old", "expiresAt": 1, **OAUTH}})
        oauth = self.usage.claude_oauth()
        self.assertEqual(oauth["accessToken"], "long-lived")
        self.assertEqual(self.usage.claude_plan(oauth), "max5")

    def test_environment_token_works_without_any_login(self):
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = "from-env"
        self.assertEqual(self.usage.claude_oauth(), {"accessToken": "from-env"})

    def test_expired_login_without_token_still_reports_expiry(self):
        self.write(".credentials.json", {"claudeAiOauth": {"accessToken": "old", "expiresAt": 1}})
        with self.assertRaisesRegex(self.usage.Unavailable, "expired"):
            self.usage.claude_oauth()


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
