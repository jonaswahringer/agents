---
name: rnd
description: Research a problem, get the report judged and revised, then race the top approaches in dedicated worktrees.
disable-model-invocation: true
---

# R&D

Take the problem in the user's message through one R&D loop: research → report → judge → revise → race. The deliverables are a judged report in chat and competing implementations, one per worktree.

1. **Research.** Read the relevant code and compare the candidate approaches — including how the baseline branch (`main` unless the user names another) does it today. Done when you can explain why the problem happens and how each approach differs.

2. **Report.** Outline the findings in chat using the `nice-to-read` skill. End with numbered **hypotheses**: each names one approach and predicts why it would win. Done when every hypothesis is specific enough to test in code.

3. **Judge.** Spawn an LLM-as-a-Judge agent (Fable 5 `low` or GPT 5.6 Sol `low`) to critique and grade the report: is the analysis sound, are the hypotheses testable, is an obvious alternative missing? Done when you have a grade and a concrete list of criticisms.

4. **Revise.** Spawn a second agent (Fable 5 `medium`–`high`) with the report and the judge's feedback to improve it, and post the revised report in chat. Done when every criticism is addressed or explicitly rebutted.

5. **Race.** Build the top hypotheses (default 3) in parallel, each in a dedicated worktree named for the approach it tests (`paper-css-import`, not `attempt-2`). Done when each worktree demonstrates its approach and you have posted a `nice-to-read` comparison: what each tried, what its result was, and which you would ship.
