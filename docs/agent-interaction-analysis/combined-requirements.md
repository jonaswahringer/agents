# Combined agent interaction requirements

Date: 2026-09-10

## Evidence boundary

The Mac mini and private MacBook reports are separate evidence sets. Both support
the response contract below, but their inventories have different coverage and
must not be treated as one complete conversation archive.

The Mac mini evidence is strongest for machine boundaries, progress updates,
mutation gates, and keeping shared configuration coherent. The private MacBook
evidence independently confirms the response preferences and adds direct examples
of repeated conclusions, premature state changes, runtime assumptions, and broken
skill metadata.

## Shared findings

Both machines support these requirements with high or medium-high confidence:

- Put the result first and make the answer understandable in one pass.
- Use plain words and keep narrow answers short. Add depth for risk, ambiguity, or
  an explicit request.
- Use prose by default. Use lists or tables only when they improve scanning.
- Remove filler, hype, sycophancy, repetition, and vague claims.
- Preserve facts, conditions, uncertainty, open decisions, and requested detail.
- Distinguish inspection, automated tests, observed runtime behavior, failed
  checks, and skipped checks.
- Do not invent missing product or business rules.
- Keep one canonical source for shared instructions and skills.
- Ask before commits, pushes, and other high-impact mutations covered by the
  user's global or project rules.

## Final implementation requirements

1. Keep the global instruction template short and stable. It should contain the
   saved machine profile, mutation gates, the core response contract, and the
   non-trivial-work progress rule.
2. Create `jonasw/nice` as the canonical user-facing response skill.
3. Merge the one-pass structure from `nice-to-read` with the useful anti-filler,
   anti-hype, anti-sycophancy, plain-language, and concrete-writing rules from
   `pstack/unslop`.
4. Default to concise answers, but preserve detail that changes a decision or
   proves the result.
5. Preserve honest verification. Never imply that a test or runtime check ran
   when it did not.
6. Do not force opinions, personality, sentence rhythm, informal language, or
   decorative formatting.
7. Keep project checks, domain rules, machine paths, provider details, and private
   memories outside `nice`.
8. Keep `pstack/unslop` available for explicit prose editing, but do not require
   both writing skills on every response.
9. Migrate saved `nice-to-read` selections and managed links to `jonasw/nice`
   without changing unrelated skill selections.
10. Replace the two known legacy response lines in installer-managed global files
    while preserving profile answers and personal additions.
11. Install `jonasw/nice` whenever managed global configuration is enabled so the
    global instruction never points to a missing skill.
12. Validate shipped skill front matter before installation so a malformed skill
    cannot be linked into every agent.
13. Test installation, selection migration, generated instructions, shared links,
    and metadata rejection in temporary home directories.

## Machine-specific findings not generalized

- The Mac mini's always-on role, network reachability, and Git transfer workflow
  belong in its saved profile, not in `nice`.
- The private MacBook's paths, worktrees, authentication failures, MCP failures,
  and accidentally inspected credential file are local operational facts. They do
  not define generic response behavior.
- The MacBook report found malformed skills outside this repository. That supports
  repository-side metadata validation, but it does not prove that every installed
  external skill is malformed.

## Uncertainty

Neither machine had a complete cloud conversation archive. The reports are
qualitative, not statistical. No evidence supports a fixed word count, a forced
persona, or automatic environment mutations, so the implementation adds none.
