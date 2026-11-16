# Architecture

For understanding, designing, or visualizing a system: how it moves between states, where its boundaries are, and which rules must always hold. Every flow we look at becomes a checked statechart, drawn in my words.

## Start questions

- Which system or flow, and seen by whom: an end user, an operator, or another service?
- Are we understanding something that exists, or designing something new?
- What must never happen? Each answer is a candidate rule.
- What can the model leave out?

## Taste calls

- **The rules.** Which invariants matter, and their wording. A rule is a product decision, so it is mine. Never weaken one to make it hold.
- **The words.** Labels on states and arrows, in the reader's words, such as "Paying" or "you press play [while the file loads]".
- **The cut.** What the chart merges or hides to stay near 20 arrows.
- **Boundaries and names** of modules, services, and layers.

## Lessons

Concepts that usually carry a lesson here:

- State, event, transition, and guard.
- Safety rule versus liveness rule; deadlock versus a correct end state.
- Illegal states made unrepresentable; a state machine versus scattered booleans.
- Interleavings and race conditions between concurrent actors.
- A model is an abstraction: name what it leaves out. When a bug path does not reproduce in the code, suspect the model first.
- Where state lives and who owns it: source of truth, coupling, seams.

**Predict first:** before each check runs, I say which rules I expect to break and where. **Explain-back:** I walk a bug path step by step in my own words.

**Worth doing by hand:** writing the rules in plain words, labelling states and arrows, and writing the model for one action.

## Artifacts and visuals

- **One statechart per flow.** A TLA+ spec, its config, and a view module, checked by TLC and drawn as Mermaid. Keep them in a scratch folder outside the repo unless I ask to keep them.
- **Bug paths.** Each broken rule as numbered steps in my words. When the model describes code, replay each path against that code as a test or live repro.
- **Structure.** For boundaries rather than behaviour, a C4 or module diagram.
- **Build-up.** When explaining, draw the chart in stages, adding one part per drawing, rather than showing it all at once.

One chunk is one flow or one rule.

## Skills

- `statechart` (pstack): every flow. If it is not installed, say so and ask before going on. Do not hand-draw a chart in its place.
- `c4-explorer` (jonasw): system structure and drill-down into an unfamiliar codebase.
- `how` and `why` (pstack): trace how existing code works and why it was built that way, before modelling it.
- `codebase-design` and `domain-modeling` (mattp): vocabulary for modules, seams, and domain terms.
