---
name: executive-summary
description: Write the user an executive summary with the bottom line up front, so they can stop after the first sentence. Use when the user asks for an executive summary of a decision, project status, incident, or findings.
---

# Executive summary

The reader is always the user. They have two minutes, act on what they read, and may stop after the first sentence. Write **BLUF**: the bottom line first, then only what the user needs to trust it and act on it.

## Steps

1. **Pin the ask.** Name what the user does after reading: decide, approve, unblock, or just know. When the request and the material leave this unclear, ask before drafting. Done when you can finish the sentence "After reading this, the user will <action>."
2. **Read all the source.** Read every document, thread, diff, and result the summary covers. Pull out what the user will weigh: numbers, dates, costs, owners, risks, and decisions already made. Done when every source is read and each fact you will use is traced to where it came from.
3. **Find the bottom line.** Write one sentence that answers the user's question with a conclusion, such as "Ship on 14 November; the last blocker is fixed." A sentence that only names the topic, like "This covers the launch", does not count. Done when that sentence alone lets the user act.
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

   <One or two sentences of context, only if the user lacks it.>

   - <Supporting point with its number>
   - <Supporting point>
   - <Supporting point>

   **Risks:** <what could still go wrong, and how likely>
   **Ask:** <what you need from the user, by when, or "None, for information">
   ```

   Done when every point passes the **so-what** test (it changes what the user thinks or does) and everything that fails it is cut.
5. **Read it as the user.** Check each of these, fix what fails, and check again:
   - The first sentence alone carries the conclusion.
   - Every number matches its source, and every claim is backed by the source.
   - Risks, bad news, and open questions appear in plain words at their real size.
   - Things carry the names the user already uses. Labels you coined during the work are replaced or explained.
   - It fits on one screen, about 100 to 250 words, longer only when the user asked for depth.

   Done when every check passes.

Deliver in chat unless the user names a file or format. For an HTML page, write the content with this skill and build the page with `html-communication`.
