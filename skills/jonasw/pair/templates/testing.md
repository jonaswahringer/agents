# Testing

For test strategy: deciding what to test, at which level, and how much is enough for a project or feature. The Work side is a strategy, often with the first tests that prove it; the Learn side is whatever the goal asks for, from choosing behaviours to the tooling that runs them. Ask which at Start.

## Start questions

- What would hurt most if it broke, and who would notice first?
- What runs today: which tests, how long, how flaky, and what do they catch?
- Is Learn about what to test and why, the tooling, or both?
- What is the budget: run time in CI, and time to write and keep the tests?

## Taste calls

- **What counts as correct.** The expected behaviour and each edge-case outcome are product decisions.
- **How much is enough.** The coverage target and when to stop.
- **Mock versus real.** Where a fake is acceptable and where a real dependency must run.
- **Test names.** Each name reads as a sentence about behaviour.

## Lessons

Concepts that usually carry a lesson here:

- Test behaviour, not implementation: a test that breaks on a refactor proves nothing about the product.
- The levels: unit, integration, end-to-end, and what each one can and cannot catch, at what cost.
- Layers before tests: a type, lint rule, or API that makes a mistake impossible beats a test that catches it.
- Beyond examples: property-based tests, runtime verification, and checked models for flows.
- Flakiness: its usual causes, such as time, order, shared state, and the network, and why a flaky test is worse than none.
- Evidence: a test that never failed has not shown it can.

**Worth doing by hand:** listing the behaviours that matter, and writing the first test for the riskiest one.

## Artifacts and visuals

- **A test matrix.** Behaviours as rows, levels as columns, each cell marked covered, planned, or skipped on purpose with a reason.
- **A risk map.** What breaks most often or costs most when it does, against what tests cover it today.
- **The first tests.** Each one seen failing for the right reason before it passes.

One chunk is one behaviour, or one row of the matrix.

## Skills

- `tdd` (mattp): test-first chunks.
- `create-verification-skill` (pstack, **I run it**): a reusable way for the agent to run and check the real app.
- `principle-prove-it-works` (pstack, **I run it**): verify against the real artifact, not a proxy.
- `statechart` (pstack, **I run it**): when the behaviour is a flow with rules, check it as a model. It arrives with the pstack sync.
- `programming` template: when the session moves from strategy into writing many tests.
