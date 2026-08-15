---
name: html-communication
description: Use when the user asks for a plan, spec, write-up, findings, summary, report, comparison, or UI mocks as readable HTML. Do not use for HTML that ships in the product.
---

# HTML communication

Create one self-contained HTML file for a human to read outside the terminal.

Write it like a clear technical document, not a marketing page. Lead with the result. Use plain words, short sections, and only the detail needed to support a decision.

Use inline CSS and no external assets unless the user provides them. Keep the file small enough to share easily.

For comparisons or UI mock options:

- Label choices `A`, `B`, and `C`.
- Put choices next to each other when direct comparison helps.
- State the important trade-off for each choice.
- Keep the same output file across revisions when the publishing system gives stable links by path.

When a configured publishing or upload tool is available:

- Upload only after the HTML file is complete.
- Report the public URL only after the upload succeeds.
- Do not open a browser to verify it unless the user asks.

Do not use this skill for application HTML, components, emails, or other HTML that belongs in the product codebase.
