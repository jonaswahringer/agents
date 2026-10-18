# Discover architecture from a repository

Use this when the input is a codebase, rather than an architecture model already
supplied by the user. The output should answer where a behavior lives, how it
crosses process boundaries, and which source supports that explanation.

## Establish the snapshot and question

Identify the checkout, branch, revision, tracked changes and relevant untracked
files. Record what was included. Do not silently switch branches to make the
architecture easier to explain. Read repository instructions before deciding
which application is active. If several checkouts exist, use the requested one
or state which local checkout you chose.

Start with the requested behavior or a representative user task. A useful first
pass usually combines a context view, a container view and one implementation
trace. There is no requirement to fill all four levels or inventory every file.

Use existing manifests, entry points, route registration, deployment definitions,
DB schemas and producer/consumer registration to identify executable boundaries.
Read docs as claims to corroborate. When instructions name a replacement app but
a README or deployment manifest still names its predecessor, preserve both facts
and explain which interpretation the view uses. A Compose service proves a
configuration exists; it does not prove that configuration is deployed.

Read selected source and tests. Avoid loading secrets, binary assets, installed
dependencies and generated code just to inventory the project. Source inspection
does not require starting services, downloading models or running migrations.

## Follow a behavior across boundaries

For a request, follow the actual caller, URL construction, router registration,
handler, orchestration and storage/provider call. Trace injection and runtime
registration rather than relying on imports alone. Record conditions that change
the path, such as short-query fallbacks, feature flags or provider selection.

For asynchronous work, establish the producer, stream/topic, consumer group,
registered handler, acknowledgement/retry boundary and persistence side effects.
Two consumer groups can each receive the same event; they are not necessarily
stages in a single ordered chain. An imported adapter or configured resource is
not proof that a job invokes it. Missing asset definitions, handlers or result
writers remain gaps; do not draw a completed path across them.

Distinguish query-time embedding from ingestion-time analysis, even if both are
called AI. A model loaded as a library inside an API process belongs there as a
component or code dependency, not as an invented remote service. A cache wrapper
existing in the repository does not establish that the traced request uses it.

## Choose the C4 model

- Software systems have meaningful product boundaries. A monorepo can contain
  more than one system, while another repository can contain only part of one.
- Containers are applications and data stores. A shared package, source folder,
  worker function or model library is not automatically another deployment.
  One Redis service can have cache and message-stream roles without becoming
  two fictional containers.
- Components express responsibilities inside one container. Explain groupings
  inferred from related files. Keep secondary collaborators outside a focused
  view when they would obscure its question, and disclose the omission.
- Use real classes, interfaces or functions for selected code views. Preserve
  symbol identity when a dependency reappears outside the current boundary.
  Shortened signatures are acceptable if exact source remains inspectable.

Keep environment variants separate. A local MinIO/proxy-upload configuration
and a production Tigris/direct-upload configuration are alternatives, not proof
that both storage paths run together. Label the environment represented by a
view. Do not mix a static dependency diagram with an invented execution sequence.

## Attach evidence and uncertainty

The repository adapter uses these fields on views, nodes, relationships and flows:

- `assessment: observed` for a claim directly supported by inspected code or
  configuration. This does not mean runtime verification.
- `assessment: inferred` for an architectural interpretation, such as grouping
  modules into one responsibility. Include its `rationale`.
- `assessment: configured` for an optional integration or capability whose
  invocation or activation has not been established. Include its `rationale`.
- `assessment: unknown` for a material unresolved claim, with a `rationale`
  explaining the missing evidence. Prefer a scoped question to an invented edge.
- `evidence: ['reference-id']` links to entries in the model's evidence registry.
  Each entry has repository-relative `path`, one-based `line`, `endLine`, and a
  `reason` stating what that range establishes. Keep ranges focused.

Maintain evidence for relationships as carefully as for elements. A source file
existing proves little about which service calls it. Record exclusions and
contradictions in a short findings file. Do not assign numerical confidence
scores without a method that supports them.

## Produce and check a project artifact

Keep the authored `model.json`, a concise `findings.md`, and the generated HTML
together in an appropriate project documentation or scratch directory. Do not
copy a private project's model or source excerpts into the shared skill. The
model is an analyst-authored account supported by source; the builder verifies
references and embeds excerpts, but does not discover architecture itself.

Follow the repository-model contract in [contracts.md](contracts.md), then run:

```sh
python3 scripts/build-explorer.py /output/project.html \
  --model /output/model.json --repo-root /path/to/repository
bash scripts/test.sh
```

The builder requires Python 3.9+, Git and Node.js 18+ with no third-party packages.
It validates the versioned model before output, checks the recorded revision,
resolves only evidence inside that repository, rejects obvious secret-file paths, and embeds up to 40 numbered
lines per reference with the full file's SHA-256. Review selected ranges before
sharing the HTML: an offline document carries its embedded excerpts with it.
A hash identifies the file read at build time; it is not semantic validation.
Refresh the model after changes rather than only updating its revision field.

Inspect the artifact in the host browser and run `scripts/check-repository.js`
as an awaited expression. Check navigation, source access on parent and leaf
nodes, relationship evidence, scope coverage, long real symbol names/signatures,
phone paging and dialog focus. Also verify one actual application click path;
programmatically opening a view alone does not test its parent link.

The browser check covers interaction and bounded rendering, not architecture
accuracy. Cross-check the selected trace against source. If it was not executed,
say it was statically traced. List unresolved paths and configuration conflicts.
Source-only exploration can finish usefully without claiming runtime success.
