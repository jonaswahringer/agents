# Data and rendering contracts

The reusable pieces are dependency-free browser JavaScript, CSS, and semantic
HTML. They need a modern browser with native modal dialogs, Web Animations, ResizeObserver,
AbortController, color-mix, and light-dark. There are no fonts, libraries, or
runtime assets to download.

## Data provider

`C4Explorer.mount(root, source)` returns `navigate`, `inspect`, and `destroy`.
The engine scopes DOM queries to `root`. Mount one shell per explorer. Give
each shell its own root id and any static form ids when using multiple copies.

```js
const source = {
  root(sample) { return 'context'; },
  rootTrail(sample) { return [{ id: 'context', name: 'My system' }]; },
  count(sample) { return 1200; },
  async getView(id, { signal }) { /* Return the requested scope. */ },
  async search(query, sample, limit) { /* Return up to limit entries. */ }
};
```

`getView` can return a value or a promise. Honor the abort signal when the
provider performs I/O. The engine also uses a request sequence so an old
response cannot replace a newer view. Search has a separate sequence guard.
Its provider should bound requests and support cancellation or debounce when
remote. The local example performs a linear scan over compact index entries,
stopping after eight matches.

`sample` is `demo` or `scale` in the starter. Adapt or remove the fixture toggle
for a real model. `count` reports indexed appearances, which may include an
element appearing in multiple scopes. Keep logical element identity stable
across those appearances.

## Repository model

Build tooling uses Python 3.9+, Git, and Node.js 18+ for repository models.
The demo build needs Python only. No npm or pip installation is required.

The `--model` builder option uses `assets/model.js` instead of `demo.js`. Supply
JSON with this top-level shape and the views described below:

```json
{
  "schemaVersion": 1,
  "name": "Project name",
  "root": "context",
  "snapshot": {
    "revision": "full Git HEAD SHA",
    "date": "YYYY-MM-DD",
    "workingTree": "Describe included changes and excluded files"
  },
  "note": "Static inspection of the selected environment; runtime not exercised.",
  "evidence": {
    "entry": {
      "path": "src/main.py",
      "line": 1,
      "endLine": 20,
      "reason": "Registers the API routes in this process."
    }
  },
  "views": []
}
```

Replace the empty `views` array with a reachable C4 model; the excerpt is not a
complete runnable model. Views need nonempty `id`, `name`, `abstraction`,
`level` and `boundary`, and a string `description`, which may be empty. Elements need nonempty `id`, `name`
and `kind`, a string `description`, and technology for containers/components/code.
Relationships need nonempty `id`, `from`, `to`, `label` and `protocol`. Use a
plain statement such as "Not established" when a protocol is unknown. Optional
`external` and `async` flags must be booleans.

Every view, node, edge and flow has `assessment` and an `evidence` array of registry ids. Use `observed`, `inferred`, `configured`, or
`unknown`; all except `observed` also require `rationale`. These describe support
for a claim, not a measured confidence score. View `coverage` describes omitted
responsibilities, conditional behavior or environment limitations.

The adapter validates every view, evidence reference, stable element name/type/
technology across appearances, linked child boundary, and reachability. It derives
search trails from decomposition links. Each child's `scope.id` and `scope.type`
must match the element that links to it, together with its name and technology.
Use external appearances without child links where they would introduce cycles. IDs identify logical elements, not
their position in a particular diagram.

`snapshot.revision` is the full 40- or 64-character Git SHA, `date` is an ISO
calendar date, and `workingTree` records what was included or excluded.
The builder validates JSON and the adapter contract before writing. It requires
`--repo-root`, checks the full Git HEAD revision, verifies
evidence paths/ranges and embeds up to 40 numbered source lines per reference
with the complete file hash. This does not verify the prose interpretation or
prove that the worktree matches HEAD. Record included local changes explicitly.
The renderer shows these excerpts through native details in its inspector,
without fetching source or depending on a local editor URL.

Parent nodes have separate Details actions so evidence can be read without
drilling down. Leaves open the inspector directly. About this view exposes
snapshot, coverage and scope evidence. Relationship-list actions expose evidence
for those claims. About this view includes evidence for a selected flow.
Synthetic controls and fictional provenance are suppressed for repository output; providers can set `codeNote` for code inspectors.

### Scope

```js
{
  id: 'containers',
  abstraction: 'container',
  scope: { id: 'commerce', name: 'Commerce platform', type: 'system' },
  name: 'Commerce platform',
  level: 'L2 / Containers',
  boundary: 'Container view · Commerce platform',
  description: 'Applications, data stores, and external dependencies.',
  prompt: 'Open Order API to inspect components',
  nodes: [{
    id: 'api', name: 'Order API', type: 'container', shape: 'application', kind: 'API application',
    description: 'Accepts checkout requests.',
    childView: 'components', childLabel: 'components',
    tech: 'Node.js / TypeScript', owner: 'Checkout team',
    external: false
  }],
  edges: [{
    id: 'request', from: 'web', to: 'api',
    label: 'Submits checkout', protocol: 'HTTPS / JSON', async: false
  }],
  flows: [{
    id: 'checkout', name: 'Place an order',
    description: 'Ordered runtime interactions.', edges: ['request']
  }]
}
```

This excerpt omits the `web` node for brevity. Every edge endpoint must exist
in the actual scope. Node and edge ids must be unique within their respective
arrays. `validateView` rejects broken endpoints, flow references, unknown C4
types, missing container/component technologies, and mismatched containment.

`abstraction` identifies the view as `context`, `container`, `component`, `code`,
or `landscape`. `scope` identifies the parent being decomposed, not another node
on the diagram. A system scope contains containers; a container scope contains
components. A component scope contains code elements. Omit `scope` for a
context or landscape view.

Node `type` is `person`, `system`, `container`, or `component`, with `class`,
`interface`, and `function` as supported code element types inside an L4 view. Container `shape`
is `application`, `database`, or `queue`; omitted shapes default to an application
frame. `kind` describes the role in prose. It does not control rendering.
`tech` is required for containers, components, and code elements and is visible
in the diagram. Code nodes may have `attributes` and `methods`, arrays of display
signatures. The diagram shows at most six members; a native inspector shows up
to 64 per section, with explicit omission counts.

Code edges can specify `relation: 'dependency'` or `relation: 'realization'`.
A realization must point to an interface. Self-loops and repeated edge ids
within a flow are rejected because the renderer cannot represent them faithfully.
Multiple relationships between the same endpoints can be listed but do not
receive separate routing lanes. The current subset does not model
arbitrary UML associations, inheritance, multiplicity, or sequence diagrams.

`external` describes a dependency outside the current scope. Containment is not
inferred from visual proximity. `childView` represents semantic decomposition,
not just another graph filter. A view can include the same dependency as another
view without assigning it another logical identity.

### Search result

```js
{
  id: 'api', name: 'Order API', viewId: 'containers',
  location: 'L2 / Commerce platform',
  trail: [
    { id: 'context', name: 'Commerce' },
    { id: 'containers', name: 'Commerce platform', via: 'commerce' }
  ]
}
```

The final trail entry is the view containing the result. `via` identifies the
block in its parent, enabling focus restoration on Up. Search navigation opens
the correct page and selects the target. Search stays local to the active
sample in the demo.

## Rendering and motion

`projectView(view, page, size, flowId)` is independent of the DOM. It clamps the
page and size, limits local edges, and prioritizes flow edges. It returns the
number of relationships outside the page and those dropped by the local edge
budget. Selecting a flow never turns off those limits.

`layoutView` computes positions and containment independently of the DOM.
The renderer sizes code cards for wrapped signatures and lays out internal peers in two columns, or one on narrow screens,
inside a named boundary. External nodes occupy separate rows below it. The
boundary is sized to the visible internal elements; paging can show only part
of a scope. Accessible groups expose the same containment structure.

People use silhouettes, systems use large filled rectangles, application
containers use window frames, data stores use cylinders, brokers use queue
shapes, and components use smaller tabbed module shapes. Types have stable
colors and labels. External appearances turn gray while retaining their type
and shape. The diagram key explains this grammar. These are this explorer's
notation choices, not additional C4 abstraction levels.

Short edges use direct ports; long edges use gutters. This simple
routing is suitable for small explanatory scopes. It has no obstacle solver,
edge bundling, self-loop routing, or multiedge lane assignment. Those are
deliberate extension points, not supported dense-graph features.

Relationship annotations wrap the complete `label` and `protocol`. Horizontal
gutter labels wrap more narrowly than labels between rows. No abbreviated
caption replaces the intent label. The relationship list also retains both.
Node names, technologies and descriptions use two-line previews; keep them
brief. Full names, descriptions and technology remain available through details
and accessible labels. Relationship intent is never shortened this way.

The SVG arrow layer is decorative. Node buttons, a bounded relationship list,
and the detail area expose the graph through native controls. Flow step
numbers match an ordered relationship list. List truncation is disclosed.

`childView` opens a semantic child scope. Without it, a node opens a native
modal inspector near the captured click rectangle. Its width grows to 960px
within the frame, with information and visualization columns where space
permits. It stacks on narrow screens and keeps a sticky close header. The
dependency neighborhood shows up to six incoming/outgoing relationships from
the loaded view; additional relationships appear in the bounded text list.
It is an inspection visual, not another C4 abstraction or a runtime trace.
The inspector moves into
view, owns keyboard focus, and restores focus to the selected node on close.
Escape dismisses it before navigating the architecture. The summary below
the diagram is supplementary and is not the only place leaf details appear.

The shared outline uses a captured source rectangle and transforms into the
new scope's bounds. Incoming node geometry is calculated once, then animated
with transform and opacity. Outgoing transitions are cancelled when replaced.
Reduced-motion preference is checked at navigation time. No motion loops run.

Theme tokens use host variables when supplied and light/dark fallbacks for
standalone files. For embedding in an existing application, import the `.c4`
rules and omit the standalone `body` margin reset if it conflicts with the app.

## Growing beyond the starter

Choose the mechanism for the actual bottleneck:

| Observed need | Extension |
| --- | --- |
| Many mostly independent elements | Keep scope navigation; index metadata separately; load view payloads on demand. |
| A connected scope exceeds the display budget | Domain groups or server-selected endpoint neighborhoods; explicit counts and links for cross-scope relationships. |
| A flow crosses several scopes | Query the flow and build a supporting dynamic view with ordered steps and links back to static views. |
| Hundreds of overlapping edges in one scope | Compute obstacle-aware layout off the main thread, cache positions by view and model revision, aggregate parallel relationships. |
| Thousands of visible marks are actually required | Viewport culling and Canvas/WebGL edges; keep a bounded accessible DOM inspector. Do not move all node labels into inaccessible pixels. |
| Remote model or very large index | Paginated scope and neighborhood queries; server search; cancellable requests and bounded caches. |

The current projector scans the loaded scope's edges and the validator scans
the loaded view. Those costs are not bounded by the DOM budget. Partition or
query a smaller view before handing a huge dense scope to the starter.

The scale fixture has 400 software systems and 25 application containers each,
10,400 index entries in total. Only the selected scope is generated. Scope
payloads have at most 400 nodes and 399 chain edges. This tests navigation and
bounded mounting, not dense organizations or high network latency.

When measuring performance, report browser, machine, model size, visible
elements, and what the timer includes. The footer measures synchronous DOM
construction and layout reads. It excludes browser paint, animation frame
rate, initial index construction, search, and data fetching. Use a profiler
before claiming an interaction latency or FPS target.

The builder writes atomically and preserves an existing artifact if a build
fails. Output must end in `.html` and cannot replace the shell, model, or selected
source inputs. `--check` validates the model and evidence without producing HTML.
