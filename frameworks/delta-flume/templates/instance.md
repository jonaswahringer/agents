---
vessel: <type>
status: active
---

# <Instance> <type> vessel in <project>

<!-- Copy to <project>/vessels/<type>/<instance>.md. Name the instance after what it keeps, such as dependencies or docs; the name goes into each unit's key. The vessel's purpose and policy live in its type file, vessels/<type>.md in delta-flume; write here only what is true for this instance. The how goes in the project's AGENTS.md when every agent needs it, otherwise in vessels/README.md. status is active or paused; while paused, Start sends units to the queue. -->

## Here

<!-- What does this instance do in this project, in one or two lines? -->

## Scope

<!-- Which parts of the project does it cover, and which does it leave alone? It claims no subject another instance of the same type covers; a shared file is fine when each keeps a different part. -->

## Overrides

<!-- Only the policy that differs from the type file, such as weights or queue order. Write "None" if nothing differs. -->
