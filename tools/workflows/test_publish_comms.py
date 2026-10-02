"""Exercise comms delivery against a local stub, without real credentials or uploads."""
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import publish_comms


class CommsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="comms delivery ")
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.credentials = self.root / "credentials"
        self.credentials.mkdir()
        self.requests = []
        self.response_code = 200
        self.redirects = False
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers["Content-Length"])
                owner.requests.append(json.loads(self.rfile.read(length)))
                self.send_response(owner.response_code)
                self.send_header("Content-Type", "application/json")
                if owner.redirects:
                    self.send_header("Location", "/other")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "draftId": "test-draft",
                                             "publicUrl": owner.base + "/d/test-draft",
                                             "versionNumber": len(owner.requests)}).encode())

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = "http://127.0.0.1:%s" % self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        (self.credentials / "config.json").write_text(json.dumps({"apiUrl": self.base}))
        (self.credentials / "credentials.json").write_text(json.dumps({"apiKey": "stub-key"}))
        self.environment = patch.dict(os.environ, {"POSTPLAN_API_URL": "", "POSTPLAN_API_KEY": ""})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def publish(self, run_id):
        return publish_comms.publish("# T3 Code: later\n\nWait for a release.\n", run_id,
                                     self.state, self.credentials)

    def test_stable_url_and_duplicate_run(self):
        first = self.publish("1")
        second = self.publish("2")
        self.assertEqual(first["url"], second["url"])
        self.assertNotIn("draftId", self.requests[0])
        self.assertEqual(self.requests[1]["draftId"], "test-draft")
        self.assertTrue(self.publish("2")["reused"])
        self.assertEqual(len(self.requests), 2)
        self.assertEqual((self.state / "comms.json").stat().st_mode & 0o777, 0o600)

    def test_failure_preserves_last_success_and_can_retry(self):
        self.publish("1")
        self.response_code = 503
        with self.assertRaisesRegex(RuntimeError, "HTTP 503"):
            self.publish("2")
        saved = json.loads((self.state / "comms.json").read_text())
        self.assertEqual(saved["last_run_id"], "1")
        self.response_code = 200
        self.assertEqual(self.publish("2")["last_run_id"], "2")
        self.assertEqual(self.requests[-1]["draftId"], "test-draft")

    def test_redirect_does_not_forward_credentials(self):
        self.response_code = 307
        self.redirects = True
        with self.assertRaisesRegex(RuntimeError, "HTTP 307"):
            self.publish("1")
        self.assertEqual(len(self.requests), 1)
        self.assertFalse((self.state / "comms.json").exists())

    def test_changed_endpoint_requires_new_state(self):
        self.publish("1")
        with patch.dict(os.environ, {"POSTPLAN_API_URL": "https://different.example"}):
            with self.assertRaisesRegex(ValueError, "endpoint changed"):
                self.publish("2")
        self.assertEqual(len(self.requests), 1)

    def test_invalid_key_cannot_leak_into_errors(self):
        for secret in ("stub-secret\ntrailing-newline", "stub-secret\r", "stub-secret\x00", "stub-secreté"):
            (self.credentials / "credentials.json").write_text(json.dumps({"apiKey": secret}))
            with self.assertRaisesRegex(ValueError, "printable ASCII") as caught:
                self.publish("1")
            self.assertNotIn("stub-secret", str(caught.exception))
        self.assertEqual(self.requests, [])

    def test_untrusted_content_is_escaped_and_safe_links_work(self):
        document = publish_comms.render('# <script>alert(1)</script>\n\n- [PR](https://github.com/pingdotgg/t3code/pull/1)\n- [bad](javascript:alert(1))\n- <img src=x onerror=alert(1)>')
        self.assertNotIn("<script>", document)
        self.assertNotIn("<img", document)
        self.assertNotIn('href="javascript:', document)
        self.assertIn('href="https://github.com/pingdotgg/t3code/pull/1"', document)
        self.assertIn("&lt;script&gt;", document)


if __name__ == "__main__":
    unittest.main()
