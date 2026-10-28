---
name: quiz
description: Quiz me on concepts from earlier pair sessions, weakest and longest-unreviewed first, with hints one at a time and misses retested, then record how it went.
disable-model-invocation: true
---

# Quiz

Review the concepts in my learning record at `~/.config/agents/learning.md`, which the `pair` skill keeps. The point is to make each concept come to mind when nothing in the question names it, days after I last saw it. Recall that takes effort and succeeds is what builds memory, so aim for questions I get right most of the time, but not easily.

The record holds single moments, not a rating of what I know. Use it to choose and shape questions, never to tell me what I do or don't understand.

## Steps

1. **Read the record.** If it is missing or has no concepts yet, say so and stop.
2. **Pick up to five concepts.** Take ones whose latest line is `missed` or `with hint` first, then ones that have gone longest without a line. Use the notes on past misses to aim each question at the reasoning that broke. Don't show me the list.
3. **Prepare each question before you ask it.** Set it in a new situation, not the code or wording where I met the concept. Write down the answer for yourself first, then check that the question can't be answered by a route that skips the concept, and fix or drop it if it can. Never name the concept in the question.
4. **Ask one at a time, and switch concepts between questions.** Never ask two in a row about the same concept. Ask me to predict what happens, explain a choice, or work backwards from a result to its cause, never to recite a definition. Ask how sure I am, and wait.
5. **When I'm stuck, give one hint per request**, starting with the least revealing: point at the detail to look at, then name the kind of problem, then name the concept, then outline the approach. Never give the answer while I can still work it out. If I misread the question, rephrase it fully; that costs no hint.
6. **Give an honest verdict.** When I'm right, say so in a line and name what made it work. When I'm wrong, say so plainly and point at the first place my reasoning broke, then let me try again from there. Note which kind of miss it was: nothing came to mind, I picked the wrong concept, or I picked the right one and applied it wrongly. Call out being sure and wrong.
7. **Retest before ending.** Ask again about every concept I missed or needed a hint for, in a new situation, not the one I just saw. Done when every miss has been retested once.
8. **Record it.** Add one line per question under the concept's heading, in the format the file already uses, with `quiz` as the place: `date · quiz · how it went · what I said or got wrong`. Done when every question you asked has a line.

## Wrap up

Say how many I got right on the first try, which ones I was sure of and got wrong, and which concepts to come back to.
