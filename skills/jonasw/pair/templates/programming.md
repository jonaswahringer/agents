# Programming

For implementing code: a feature, a fix, or a refactor. The Work side is a working change; the Learn side is that I can explain every line of it and why it has that shape.

## Start questions

- What should change for whom, and how will we know it works?
- Which data shape sits at the centre of the change?
- Which part of the code is new to me?
- Is there a test I can run now, and does it pass?

## Each chunk

- One chunk is one function, one type, one test, or one small diff I can read in a minute.
- **Name the data shape first.** Before any logic, sketch the types and their organizing structure, such as a state machine over scattered booleans or a table over repeated branching.
- **Run it.** Each chunk ends in a check you run: a test, the type checker, or the app. Show me the result, not a claim.
- **Watch my changes.** Before each turn, read every changed hunk in the working tree and every new commit since your last turn.

## Taste calls

Product behaviour, naming, API shape, error wording, defaults, and scope. They hide inside technical questions, such as which errors to surface, what a function returns when empty, or whether a flag belongs in the API.

## Lessons

Concepts that usually carry a lesson here:

- Data shape and illegal states: making a wrong state impossible to write.
- Boundaries: where input is validated, where errors are handled, which module owns what.
- Failure modes: N+1 queries, TOCTOU races, retries without idempotency, off-by-one bounds.
- Deep versus shallow modules: a small interface hiding a lot of behaviour.
- Why a test fails before it passes, and what it proves.

**Worth doing by hand:** the core logic of a chunk that carries a lesson, the test for its tricky case, and names.

## Artifacts and visuals

- **The change.** Small diffs, each with its check.
- **A type sketch** before logic, when the change crosses a function boundary.
- **A sequence or data-flow diagram** when a call path spans three or more modules, built up one part at a time.

## Skills

- `architect` (pstack) and `codebase-design` (mattp): types, signatures, and module shape before code.
- `principle-model-the-domain` (pstack): pick the structure for stateful or branchy logic.
- `tdd` (mattp): test-first chunks. Use the `testing` template for testing-heavy work.
- `diagnosing-bugs` (mattp): hard bugs and performance regressions.
- `prototype` (mattp): a throwaway sketch to settle a design question.
- `commit` (jonasw): commit messages and pull requests.
