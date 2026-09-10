# Agent interaction analysis

This folder documents a local review of how the user works with coding agents and
how the agent setup could improve.

## Machine boundary

The documents are deliberately split by machine:

- **Mac mini** — the always-on machine where this repository and the local analysis
  were performed. The two analysis documents in this folder report only evidence
  found on that machine.
- **Private MacBook** — the separate machine where the parallel analysis prompt was
  run. Its files and complete thread history are not available from the Mac mini.
  Its report is kept separately and labelled as MacBook evidence.

Do not treat the Mac mini report as a complete view of the user's account. Local
logs can miss cloud-only, deleted, remote, or unsynchronised conversations.

## Documents

- [Mac mini pattern analysis](mac-mini-pattern-analysis.md) — recurring response
  preferences, workflow issues, and possible improvements.
- [Mac mini data inventory](mac-mini-data-inventory.md) — what local evidence was
  available, what was partial, and what could not be concluded.
- [Private MacBook pattern analysis](macbook-pattern-analysis.md) — the separate
  machine's recurring response preferences, workflow issues, and possible
  improvements.
- [Private MacBook data inventory](macbook-data-inventory.md) — the separate
  machine's available evidence, partial data, and coverage limits.
- [Parallel analysis prompt](parallel-analysis-prompt.md) — the prompt used for the
  separate machine's analysis.

## Current status

This is an analysis-only snapshot. No global config, rule, or skill was changed as
part of these reviews. The Mac mini and private MacBook reports should be compared
before creating or restructuring a personalized `nice` skill or changing shared
agent instructions.
