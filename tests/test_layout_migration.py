"""Upgrade the pre-tools layout through its existing public update command."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
LEGACY_CLI = r'''#!/usr/bin/env bash
set -e
if [[ "${1:-}" == help ]]; then echo 'legacy agents'; exit 0; fi
[[ "${1:-}" == update ]] || exit 2
shift
if [[ -n "${AGENTS_SOURCE_DIR:-}" ]]; then
  bash "$AGENTS_SOURCE_DIR/install.sh" --update "$@"
else
  tmp="$(mktemp "${TMPDIR:-/tmp}/agents-bootstrap.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  curl -fsSL "https://raw.githubusercontent.com/${AGENTS_REPOSITORY:-jonaswahringer/agents}/${AGENTS_REF:-main}/install.sh?update=${tmp##*.}" -o "$tmp"
  bash "$tmp" --update "$@"
fi
'''


class LayoutMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="agents legacy home ")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.source = self.home / ".local/share/agents/source"
        self.commands = self.home / ".local/bin"
        self.config = self.home / ".config/agents"
        (self.source / "bin").mkdir(parents=True)
        self.commands.mkdir(parents=True)
        (self.config / "profile").mkdir(parents=True)
        (self.source / "bin/agents").write_text(LEGACY_CLI)
        (self.source / "bin/agents").chmod(0o755)
        (self.source / "bin/usage").write_text("#!/bin/sh\nexit 0\n")
        (self.source / "bin/usage").chmod(0o755)
        (self.commands / "agents").symlink_to(self.source / "bin/agents")
        (self.commands / "usage").symlink_to(self.source / "bin/usage")
        (self.config / "selected-skills").write_text("jonasw/nice\n")
        (self.config / "global-config").write_text("disabled\n")
        (self.config / "profile/about-me").write_text("Keep this private profile.\n")
        self.env = dict(os.environ, HOME=str(self.home), AGENTS_SOURCE_DIR=str(ROOT),
                        AGENTS_CONFIG_DIR=str(self.config), AGENTS_INSTALL_DIR=str(self.source.parent),
                        AGENTS_BIN_DIR=str(self.commands), AGENTS_HOME=str(self.home / ".agents"),
                        CLAUDE_HOME=str(self.home / ".claude"), CODEX_HOME=str(self.home / ".codex"),
                        XDG_STATE_HOME=str(self.home / ".local/state"),
                        PATH=str(self.commands) + ":/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin")

    def run_cli(self, *args, ok=True):
        result = subprocess.run([str(self.commands / "agents"), *args], env=self.env,
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0 if ok else 1, result.stdout + result.stderr)
        return result

    def assert_updated(self):
        self.assertEqual((self.commands / "agents").resolve(), self.source / "tools/agents-cli/agents-cli")
        self.assertEqual((self.commands / "usage").resolve(), self.source / "tools/usage/usage")
        self.assertEqual((self.config / "selected-skills").read_text(), "jonasw/nice\n")
        self.assertEqual((self.config / "profile/about-me").read_text(), "Keep this private profile.\n")
        self.run_cli("doctor")
        self.assertEqual(list(self.commands.glob("*.backup-*")), [])

    def test_local_update_moves_known_command_links_and_preserves_profile(self):
        self.run_cli("update")
        self.assert_updated()

    def test_existing_remote_update_url_reaches_new_setup(self):
        checkout = self.home / "download/agents-main"
        shutil.copytree(ROOT, checkout, ignore=shutil.ignore_patterns(
            ".git", "node_modules", "__pycache__", ".env", "com.wahringer.comms.plist"))
        archive = self.home / "latest.tar.gz"
        subprocess.run(["tar", "-czf", str(archive), "-C", str(checkout.parent), "agents-main"], check=True)
        curl = self.commands / "curl"
        shutil.copyfile(ROOT / "tests/fake-update-curl.sh", curl)
        curl.chmod(0o755)
        calls = self.home / "requests"
        self.env.update(AGENTS_SOURCE_DIR="", FAKE_UPDATE_BOOTSTRAP=str(ROOT / "install.sh"),
                        FAKE_UPDATE_INSTALLER=str(ROOT / "setup/install.sh"),
                        FAKE_UPDATE_LATEST_ARCHIVE=str(archive), FAKE_UPDATE_CALLS=str(calls))
        self.run_cli("update")
        self.assert_updated()
        requested = calls.read_text().splitlines()
        self.assertTrue(any("/main/install.sh?" in url for url in requested), requested)
        self.assertTrue(any("/main/setup/install.sh?" in url for url in requested), requested)

    def test_failed_update_restores_the_old_command_and_snapshot(self):
        broken = self.home / "broken source"
        (broken / "setup").mkdir(parents=True)
        (broken / "tools/agents-cli").mkdir(parents=True)
        shutil.copyfile(ROOT / "install.sh", broken / "install.sh")
        shutil.copyfile(ROOT / "setup/install.sh", broken / "setup/install.sh")
        (broken / "tools/agents-cli/agents-cli").write_text("#!/usr/bin/env bash\nexit 1\n")
        self.env["AGENTS_SOURCE_DIR"] = str(broken)
        self.assertIn("previous version was restored", self.run_cli("update", ok=False).stderr)
        self.assertEqual((self.commands / "agents").resolve(), self.source / "bin/agents")
        self.assertEqual(self.run_cli("help").stdout.strip(), "legacy agents")
        self.assertEqual((self.config / "profile/about-me").read_text(), "Keep this private profile.\n")


if __name__ == "__main__":
    unittest.main()
