---
name: c4-explorer
description: Explore a repository's architecture through source-backed C4 diagrams, traced behaviors, and interactive drill-down. Use to understand an unfamiliar codebase or build an architecture explorer from an existing model.
---

# C4 explorer

Build a navigable account of an architecture, with evidence readers can inspect.
Use the supplied HTML, CSS and JavaScript rather than rebuilding the explorer.

## Start from a repository

Read [repository discovery](references/repository-discovery.md) before modeling.
Establish the checkout, revision, active applications and environment represented.
Trace a useful behavior through its caller, entry points, in-process collaborators
and persistence or messaging. Distinguish observed code, inferred boundaries,
configured capabilities and unresolved paths. Preserve disagreements between
instructions, documentation and configuration.

Author a project-specific `model.json` using the
[repository-model contract](references/contracts.md#repository-model). Give views,
elements, relationships and flows source references. Use actual symbols for
selective code views. Record omissions and conditions; do not invent a completed
path across missing implementation or imply a static trace was executed.

Keep the model, concise findings and generated HTML together outside this shared
skill. Project source excerpts belong in that artifact, not in the skill package.

```sh
python3 scripts/build-explorer.py /output/project.html \
  --model /output/model.json --repo-root /path/to/repository
```

Commands are relative to this skill. Build tooling requires Python 3.9+;
repository builds also require Git and Node.js 18+. No third-party packages are used.
The HTML runs offline in a modern browser without those build tools.

The builder validates the model with the same JavaScript adapter used at runtime,
checks its revision/source ranges, and embeds numbered excerpts and file hashes.
It is not an automatic architecture extractor. Inspect selected ranges before
sharing the generated document. Validate without writing with:

```sh
python3 scripts/build-explorer.py --check \
  --model /output/model.json --repo-root /path/to/repository
```

## Start from a supplied model or the demo

Use [the provider and view contracts](references/contracts.md) to adapt an
existing model. The reusable pieces are:

- [assets/shell.html](assets/shell.html): controls, diagram region and native dialog.
- [assets/explorer.css](assets/explorer.css): scoped styling and theme tokens.
- [assets/explorer.js](assets/explorer.js): validation, bounded rendering and navigation.
- [assets/model.js](assets/model.js): repository-model validation, indexing and search trails.
- [assets/demo.js](assets/demo.js): fictional commerce model and synthetic scale fixture.

Build the fictional demo without repository input:

```sh
python3 scripts/build-explorer.py /output/c4-demo.html
```

For app integration, keep the blocks separate and call
`C4Explorer.mount(rootElement, source)`. Give each shell its own root and form ids.
The shell's default root id is `c4-explorer`. Omit the standalone body margin
reset when integrating into an existing application.

## Preserve meaning and navigation

Read [the C4 guidance audit](references/c4-guidance.md) before claiming C4
conformance. Preserve scope, containment, explicit types, responsibilities,
technologies and directional relationship intent. C4 is notation independent;
these shapes, grid and transitions are explorer choices.

Context shows systems and people. A system contains containers, a container
contains components, and a component can contain selected classes, interfaces or
functions. Put dependencies physically outside the named boundary. Keep logical
identity and shape stable across views. Do not equate a folder with a component,
a library with a remote service, or a C4 container with Docker.

Keep Back to parent prominent inside the diagram, with the destination's name,
and preserve breadcrumbs and parent focus. Animate drill-down from the clicked
block using finite transform/opacity transitions. Cancel superseded work, respect
reduced motion and render the initial view without an entrance animation.

A parent drills into its child view and has a separate Details action when it
has evidence. A leaf opens a wide native inspector with implementation details,
source excerpts and a dependency neighborhood. Show scope/evidence through About
this view and relationship evidence through the relationship list. Escape closes
the dialog before navigating upward, then closing restores focus.

## Keep large models understandable

Navigate by scope and search. The renderer mounts at most 12 node buttons,
36 SVG relationships, 36 relationship buttons and 8 search results. Phones use
6 nodes per page. Disclose off-page and omitted connections. Boundaries enclosing
a page do not imply that page contains the entire scope.

For highly connected scopes, group by responsibility or query a neighborhood or
flow before rendering. The repository adapter eagerly validates/indexes its JSON;
the replaceable provider supports lazy scopes. Read the
[scale decisions and limitations](references/contracts.md#growing-beyond-the-starter)
before claiming support for a huge or dense graph. The grid router is not a
general obstacle solver and rejects self-loops. Repeated flow-edge occurrences
need a dedicated sequence view rather than duplicate step numbers on one arrow.

## Verify and deliver

After changing reusable code, run the package checks:

```sh
bash scripts/test.sh
```

Inspect generated output in the host browser at desktop and phone widths, light
and dark themes, and with reduced motion. Run the relevant browser check as an
awaited JavaScript expression in the page:

- `scripts/check-repository.js` for repository output.
- `scripts/check-browser.js` and `scripts/check-component-details.js` for the demo.

These checks change page state. Also exercise the actual parent-to-code click
path and verify the traced behavior against source. Check complete relationship
labels, real signatures, dialog visibility, evidence access and focus restoration.
Browser tests establish interaction behavior, not architecture accuracy.

For T3 chat, call `html_preview`, inspect the screenshot/console, then call
`html_render` with the complete document. Otherwise use the host's supported
HTML surface or deliver the standalone file. Do not start a server just to show
an offline artifact. Report actual checks and unresolved gaps; the scale fixture
and DOM timer do not establish dense routing quality or a frame-rate guarantee.
