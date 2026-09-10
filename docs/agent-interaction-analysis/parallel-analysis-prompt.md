# Prompt for the private MacBook analysis

You are analyzing the user's private MacBook. Do not assume that files on the
Mac mini are available, and do not attribute Mac mini evidence to this machine.

Inspect the local Cursor, Claude Code, Codex, and T3 Code data that is actually
available. Find recurring patterns in:

- how the user wants agents to respond,
- repeated agent mistakes,
- workflow friction,
- useful automation,
- what belongs in global instructions, `AGENTS.md`, configs, rules, memories,
  or skills.

Treat these as preferences to verify:

- Put the answer first.
- Be brief, direct, and plain.
- Explain difficult ideas simply. If the user asks to “explain it like I am
  five,” use a simple model and a small example.
- Use bullets or tables only when they improve scanning.
- Say what was checked, skipped, failed, or remains uncertain.
- Do not invent missing requirements.
- Verify real behavior, not only tests.
- Ask before commits, pushes, destructive changes, or Docker Compose changes.
- Do not auto-commit.

First inventory the available files and transcripts. Distinguish complete
conversations from metadata, logs, or partial data. Do not read or copy secrets.

Produce:

1. A summary table with:
   - pattern or issue,
   - evidence,
   - confidence,
   - automation opportunity,
   - best configuration home.
2. A short coverage document explaining:
   - what data was available,
   - what was incomplete,
   - what cannot be concluded.

Pay special attention to whether a personalized `nice` skill would help: a
readable, anti-filler, anti-hype fork of the useful parts of pstack's `unslop`,
possibly combined with `nice-to-read`. Verify this idea against the evidence.

Do not modify configs, rules, or skills yet. This report will be combined with
the separate Mac mini report before implementation.
