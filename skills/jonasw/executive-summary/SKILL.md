---
name: executive-summary
description: Write an executive summary with the bottom line up front, for a decision-maker who reads only the top. Use when the user asks for an executive summary or a leadership or stakeholder brief on a decision, project status, incident, or findings.
---

# Executive summary

The **reader** has two minutes, acts on what they read, and may stop after the first sentence. Write **BLUF**: the bottom line first, then only what the reader needs to trust it and act on it.

## Steps

1. **Pin the reader and the ask.** Name who reads it and what they do next: decide, approve, unblock, fund, or just know. When neither the user nor the material makes this clear, ask before drafting. Done when you can finish the sentence "After reading this, <reader> will <action>."
2. **Read all the source.** Read every document, thread, diff, and result the summary covers. Pull out what the reader will weigh: numbers, dates, costs, owners, risks, and decisions already made. Done when every source is read and each fact you will use is traced to where it came from.
3. **Find the bottom line.** Write one sentence that answers the reader's question with a conclusion, such as "Ship on 14 November; the last blocker is fixed." A sentence that only names the topic, like "This covers the launch", does not count. Done when that sentence alone lets the reader act.
4. **Build the pyramid.** Put at most three supporting points under the bottom line, each a claim carrying its strongest fact or number. Then add the risks and the ask. Pick the shape for the kind of summary:

   | Kind     | Bottom line                       | Support                                      | Ask                              |
   | -------- | --------------------------------- | -------------------------------------------- | -------------------------------- |
   | Decision | The recommendation                | Options weighed, cost and risk of each       | Approve, by a date               |
   | Status   | On track, at risk, or off track   | What changed since the last update, blockers | Unblock, or none                 |
   | Incident | The impact, and whether it's over | Cause, fix, prevention                       | Approve prevention work, or none |
   | Findings | The answer and your confidence    | Evidence, implications                       | What to do with it               |

   Lay it out like this:

   ```markdown
   **<Bottom line in one sentence.>**

   <One or two sentences of context, only if the reader lacks it.>

   - <Supporting point with its number>
   - <Supporting point>
   - <Supporting point>

   **Risks:** <what could still go wrong, and how likely>
   **Ask:** <what you need from the reader, by when, or "None, for information">
   ```

   Done when every point passes the **so-what** test (it changes what the reader thinks or does) and everything that fails it is cut.
5. **Read it as the reader.** Check each of these, fix what fails, and check again:
   - The first sentence alone carries the conclusion.
   - Every number matches its source, and every claim is backed by the source.
   - Risks, bad news, and open questions appear in plain words at their real size.
   - Things are named the way the reader names them: products and outcomes, with file names, ticket IDs, and team jargon translated.
   - It fits on one screen, about 100 to 250 words, longer only when the reader asked for depth.

   Done when every check passes.

Deliver in chat unless the user names a file or format. For an HTML page, write the content with this skill and build the page with `html-communication`.
