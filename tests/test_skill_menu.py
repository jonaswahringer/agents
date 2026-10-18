"""Exercise the actual Bash menu through a terminal, with an isolated home."""

import errno
import fcntl
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import tempfile
import termios
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
CREATORS = sorted(folder.name for folder in (ROOT / "skills").iterdir()
                  if folder.is_dir() and any(folder.glob("*/SKILL.md")))
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


class Menu:
    def __init__(self, home, command="skills", rows=24, columns=80, no_color=False,
                 selected=(), link_delay=0, link_exit=0):
        self.home = Path(home)
        self.config = self.home / ".config/agents"
        self.config.mkdir(parents=True, exist_ok=True)
        (self.config / "global-config").write_text("disabled\n")
        if selected:
            (self.config / "selected-skills").write_text("\n".join(selected) + "\n")
        link_bin = self.home / "test-bin"
        if link_delay or link_exit:
            link_bin.mkdir()
            link = link_bin / "ln"
            link.write_text(f'#!/bin/bash\nsleep {link_delay}\n' +
                            (f'echo "link failed" >&2\nexit {link_exit}\n' if link_exit else
                             f'exec {shutil.which("ln")} "$@"\n'))
            link.chmod(0o755)
        self.pending = b""
        self.output = b""
        self.status = None
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            env = dict(os.environ, HOME=str(home), TERM="xterm-256color")
            if link_delay or link_exit:
                env["PATH"] = str(link_bin) + os.pathsep + env["PATH"]
            for key in ("AGENTS_CONFIG_DIR", "AGENTS_HOME", "CLAUDE_HOME", "CODEX_HOME",
                        "XDG_CONFIG_HOME", "NO_COLOR"):
                env.pop(key, None)
            if no_color:
                env["NO_COLOR"] = "1"
            fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
            shell = env.get("AGENTS_TEST_BASH", "/bin/bash")
            os.execve(shell, [shell, str(ROOT / "bin/agents"), command], env)
        self.original_terminal = termios.tcgetattr(self.fd)

    def read(self, timeout=0.1):
        if select.select([self.fd], [], [], timeout)[0]:
            try:
                data = os.read(self.fd, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                return
            self.pending += data
            self.output += data

    def until(self, text):
        deadline = time.monotonic() + 8
        while text not in self.output:
            if time.monotonic() > deadline:
                raise AssertionError(f"Missing {text!r}: {self.output[-2000:]!r}")
            self.read()

    def frame(self, keys=None):
        if keys is not None:
            os.write(self.fd, keys)
        deadline = time.monotonic() + 8
        while b"\x1b[J" not in self.pending:
            if time.monotonic() > deadline:
                raise AssertionError(f"Menu did not draw a frame: {self.output[-2000:]!r}")
            self.read()
        raw, self.pending = self.pending.split(b"\x1b[J", 1)
        text = ANSI.sub("", raw.decode()).replace("\r", "")
        return text

    def finish(self, keys=b"q"):
        if keys:
            os.write(self.fd, keys)
        deadline = time.monotonic() + 8
        while self.status is None:
            self.read()
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.status = os.waitstatus_to_exitcode(status)
            elif time.monotonic() > deadline:
                raise AssertionError(f"Menu did not exit: {self.output[-2000:]!r}")
        self.read(0)
        return self.status

    def close(self):
        if self.status is None:
            os.kill(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        os.close(self.fd)


class SkillMenuTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory(prefix="agents menu ")
        self.addCleanup(self.home.cleanup)

    def menu(self, **options):
        menu = Menu(self.home.name, **options)
        self.addCleanup(menu.close)
        return menu

    def assert_active(self, frame, name):
        self.assertRegex(frame, rf"(?m)^\s*> \[[ x-]\] {re.escape(name)}(?:\s|$)")

    def creator_key(self, name):
        number = CREATORS.index(name) + 1
        self.assertLessEqual(number, 9)
        return str(number).encode()

    def assert_restored(self, menu):
        self.assertEqual(termios.tcgetattr(menu.fd), menu.original_terminal)
        self.assertIn(b"\x1b[?25h", menu.output)
        self.assertIn(b"\x1b[?1049l", menu.output)

    def test_creator_shortcuts_and_tab_skip_open_skills(self):
        menu = self.menu(command="skill")
        frame = menu.frame()
        self.assertIn("  ".join(f"{number} {name}" for number, name in
                                enumerate(CREATORS[:9], 1)), frame)
        self.assert_active(menu.frame(b"p"), "pstack")
        self.assert_active(menu.frame(b"\t"), "jonasw")
        self.assert_active(menu.frame(b"\x1b[Z"), "pstack")
        self.assert_active(menu.frame(self.creator_key("mattp")), "mattp")
        matches = [name for name in CREATORS if name.startswith("m")]
        next_match = (matches.index("mattp") + 1) % len(matches)
        self.assert_active(menu.frame(b"m"), matches[next_match])
        current = matches[(next_match + 1) % len(matches)]
        self.assert_active(menu.frame(b"M"), current)
        if len(CREATORS) < 9:
            self.assert_active(menu.frame(b"9"), current)
        self.assertEqual(menu.finish(), 1)
        self.assertFalse((menu.config / "selected-skills").exists())
        self.assert_restored(menu)

    def test_scroll_and_resize_keep_cursor_and_controls_visible(self):
        menu = self.menu()
        menu.frame()
        menu.frame(b"p")
        for _ in range(20):
            frame = menu.frame(b"\x1b[B")
            self.assertLessEqual(len(frame.splitlines()), 23)
            self.assertIn("Enter save", frame)
            self.assertIn("q / Esc cancel", frame)
            self.assertEqual(frame.count("> ["), 1)
        self.assertNotIn("Rows 1-", frame)
        fcntl.ioctl(menu.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 16, 48, 0, 0))
        os.kill(menu.pid, signal.SIGWINCH)
        frame = menu.frame()
        self.assertLessEqual(len(frame.splitlines()), 15)
        self.assertTrue(all(len(line) <= 48 for line in frame.splitlines()))
        self.assertIn("Enter save", frame)
        self.assertIn("q / Esc cancel", frame)
        self.assertEqual(frame.count("> ["), 1)
        self.assertEqual(menu.finish(), 1)

    def test_save_single_skill_and_preserve_existing_selection(self):
        menu = self.menu(selected=("jonasw/nice",))
        menu.frame()
        menu.frame(self.creator_key("mattp"))
        self.assert_active(menu.frame(b"\x1b[B"), "ask-matt")
        frame = menu.frame(b" ")
        self.assertIn("2 of ", frame)
        self.assertEqual(menu.finish(b"\n"), 0)
        self.assertEqual(set((menu.config / "selected-skills").read_text().splitlines()),
                         {"jonasw/nice", "mattp/ask-matt"})
        for target in (".agents", ".claude", ".codex"):
            for name in ("nice", "ask-matt"):
                link = menu.home / target / "skills" / name
                self.assertTrue(link.is_symlink(), link)
                self.assertTrue(link.exists(), link)
        self.assert_restored(menu)

    def test_loading_dots_animate_until_installation_finishes(self):
        menu = self.menu(link_delay=0.6)
        menu.frame()
        menu.frame(self.creator_key("mattp"))
        menu.frame(b"\x1b[B")
        menu.frame(b" ")
        self.assertEqual(menu.finish(b"\n"), 0)
        updates = re.findall(rb"Updating skills (\.{1,3})(?!\.)", menu.output)
        self.assertTrue({b".", b"..", b"..."}.issubset(updates), menu.output[-2000:])
        self.assertIn(b"Selected skills updated.", menu.output)
        self.assert_restored(menu)

    def test_loading_clears_on_failure_and_preserves_error(self):
        menu = self.menu(link_delay=0.6, link_exit=23)
        menu.frame()
        menu.frame(self.creator_key("mattp"))
        menu.frame(b"\x1b[B")
        menu.frame(b" ")
        self.assertEqual(menu.finish(b"\n"), 23)
        self.assertIn(b"Updating skills", menu.output)
        self.assertIn(b"link failed", menu.output)
        self.assertNotIn(b"Selected skills updated.", menu.output)
        self.assertFalse((menu.config / "selected-skills").exists())
        self.assertTrue(menu.output.rfind(b"\x1b[?25h") >
                        menu.output.rfind(b"Updating skills"))
        self.assert_restored(menu)

    def test_loading_pauses_for_replacement_prompt(self):
        menu = self.menu(link_delay=0.3)
        existing = menu.home / ".agents/skills/ask-matt"
        existing.parent.mkdir(parents=True)
        existing.write_text("user-owned skill\n")
        menu.frame()
        menu.frame(self.creator_key("mattp"))
        menu.frame(b"\x1b[B")
        menu.frame(b" ")
        os.write(menu.fd, b"\n")
        menu.until(b"[y/N] ")
        prompt_end = menu.output.index(b"[y/N] ") + len(b"[y/N] ")
        deadline = time.monotonic() + 0.7
        while time.monotonic() < deadline:
            menu.read()
        self.assertNotIn(b"Updating skills", menu.output[prompt_end:])
        self.assertEqual(menu.finish(b"n\n"), 0)
        self.assertEqual(existing.read_text(), "user-owned skill\n")
        self.assertIn(b"Skipped", menu.output)
        self.assert_restored(menu)

    def test_interrupt_during_loading_stops_animation(self):
        menu = self.menu(link_delay=2)
        menu.frame()
        menu.frame(self.creator_key("mattp"))
        menu.frame(b"\x1b[B")
        menu.frame(b" ")
        os.write(menu.fd, b"\n")
        menu.until(b"Updating skills")
        self.assertEqual(menu.finish(b"\x03"), 130)
        output = menu.output
        deadline = time.monotonic() + 0.7
        while time.monotonic() < deadline:
            menu.read()
        self.assertEqual(menu.output, output)
        self.assert_restored(menu)

    def test_escape_discards_toggles_and_no_color_keeps_cursor_marker(self):
        menu = self.menu(no_color=True)
        menu.frame()
        menu.frame(b"p")
        frame = menu.frame(b" ")
        self.assert_active(frame, "pstack")
        self.assertIn("44/44", frame)
        self.assertNotIn(b"\x1b[7m", menu.output)
        self.assertEqual(menu.finish(b"\x1b"), 1)
        self.assertFalse((menu.config / "selected-skills").exists())
        self.assert_restored(menu)

    def test_interrupt_restores_terminal_without_saving(self):
        menu = self.menu()
        menu.frame()
        menu.frame(b" ")
        self.assertEqual(menu.finish(b"\x03"), 130)
        self.assertFalse((menu.config / "selected-skills").exists())
        self.assert_restored(menu)

    def test_idle_menu_keeps_waiting(self):
        menu = self.menu()
        menu.frame()
        deadline = time.monotonic() + 2.2
        while time.monotonic() < deadline:
            menu.read()
        self.assert_active(menu.frame(b"p"), "pstack")
        self.assertEqual(menu.finish(), 1)
        self.assert_restored(menu)

    def test_home_end_page_and_unknown_escape_sequences(self):
        menu = self.menu()
        menu.frame()
        last_skill = sorted((ROOT / "skills/pstack").glob("*/SKILL.md"))[-1].parent.name
        self.assert_active(menu.frame(b"\x1b[F"), last_skill)
        frame = menu.frame(b"\x1b[5~")
        self.assertIn("q / Esc cancel", frame)
        self.assert_active(menu.frame(b"\x1b[H"), "Skills")
        frame = menu.frame(b"\x1b[3~")
        self.assert_active(frame, "Skills")
        self.assertIn("0 of ", frame)
        self.assertEqual(menu.finish(), 1)


if __name__ == "__main__":
    unittest.main()
