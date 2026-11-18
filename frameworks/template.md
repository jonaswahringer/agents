# <Name> vessel

## Purpose

<!-- Why does this vessel exist? Write what stays true for decades. -->

## Policy

### Unit

<!-- What is one piece of work here, and what is its idempotency key? -->

### Triggers

<!-- Which typed triggers does it accept? Loose ones only reach it after triage and a human route. -->

### Weight

<!-- How does a unit get its weight (low, normal, high, critical), and who or what sets it? -->

### Gateway

<!-- Accept: when does it decline a unit (duplicate without new input, superseded, incomplete)? Start: when does a unit wait (overloaded, paused)? Estimate: see Retry budget. -->

### Verify

<!-- Which checks run in the agent loop, cheapest first: static analysis and tests, runtime verification, review agent? -->

### Retry budget

<!-- How is a unit's size estimated (a deterministic number, or an agent)? What multiple of the estimate is the hard ceiling? -->

### Land

<!-- Which work classes may land without a human? Only reversible ones qualify. -->

### Output

<!-- What does it produce? -->

### Record

<!-- Where does it leave source, reasoning and decision for each unit? A PR, git history, an issue, a log? -->

### Done

<!-- When is a unit finished? -->

## Mechanism

<!-- Which agents and tools do the work today? List them as replaceable. -->
