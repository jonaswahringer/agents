---
name: html-communication
description: Use when the user asks for a plan, spec, write-up, findings, summary, report, comparison, or UI mocks as readable HTML. Do not use for HTML that ships in the product.
---

# HTML communication

Create one self-contained HTML file for a human to read outside the terminal.

Write it like a clear technical document, not a marketing page. Lead with the result. Use plain words, short sections, and only the detail needed to support a decision.

Use inline CSS and no external assets unless the user provides them. Keep the file small enough to share easily.

## Colors

Style the document only through the CSS variables listed in [theme.css](theme.css). No color literal appears anywhere else in the file.

Resolve the palette in this order, then inline it. Never link it or `@import` it.

1. Colors the user gives in the request.
2. `.agents/html-brand.css` in the project.
3. `~/.config/agents/html-brand.css`.
4. `theme.css` in this skill, neutral grays with the Wahringer OG accents.

Check for the project file before writing. When it is missing and the project has a brand to read (a logo, a design token file, CSS variables in the app, a Tailwind config), offer to create one, show the file, and wait for approval. Never write it unasked, and never hold up the document over it. Fall back to the default and ask once.

A brand file sets tokens and nothing else. No element selectors and no layout, so a wrong file can only recolor. Most brand files only need `--accent`, `--accent-fg`, `--accent-2`, and `--link`.

Keep body text at 4.5:1 against its background in both schemes. A brand color that fails that goes on headings, links, and rules instead, and `--fg` stays near-black or near-white. Define both schemes, light in `:root` and dark under `prefers-color-scheme: dark`.

Keep the styling as restrained as the writing. Hairline rules, flat surfaces, generous whitespace, no gradients or shadows. Tables get horizontal rules, not a grid of boxes.

Buttons are rounded rectangles, not pills and not tight boxes. Corner radius sits near a quarter of the button height (`var(--radius)` at a normal size), side padding near half the height, and the label at body size in medium weight. A primary button fills with `--accent` and labels in `--accent-fg`; a secondary one fills with `--surface` and takes a 1px `--line` border. No shadows, no uppercase labels, no letter-spacing.

Chart series colors come from the dataviz skill. Use `--fg`, `--muted`, and `--line` for axes, labels, and gridlines so the chart belongs to the document.

For comparisons or UI mock options:

- Label choices `A`, `B`, and `C`.
- Put choices next to each other when direct comparison helps.
- State the important trade-off for each choice.
- Keep the same output file across revisions when the publishing system gives stable links by path.

When the document defines terms a reader would otherwise look up elsewhere, add a glossary and read [glossary-links.md](glossary-links.md) first. Every use of a glossary term then links to its definition, with a button back to where the reader was.

When a configured publishing or upload tool is available:

- Upload only after the HTML file is complete.
- Report the public URL only after the upload succeeds.
- Do not open a browser to verify it unless the user asks.

Do not use this skill for application HTML, components, emails, or other HTML that belongs in the product codebase.
