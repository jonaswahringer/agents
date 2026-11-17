# UI and UX

For designing a new screen or flow, critiquing an existing UI, building it in code, or design system work. The Work side is the design or the shipped UI; the Learn side is why it works for its user, in terms I can apply to the next screen.

## Start questions

- Which mode: design something new, critique what exists, build it, or work on the design system?
- Who uses this screen, what are they trying to do, and what do they do right before and after?
- Where does the design live: the code, a design tool such as Figma, Paper, or Claude Design, or nowhere yet?
- What constraints are fixed: platform, existing components, brand, accessibility needs?

## Taste calls

Layout, hierarchy, copy, flow, motion, density, and the look. Ask what I want before you show anything. Then show two or three options that serve what I said, and give your pick.

## Lessons

Concepts that usually carry a lesson here:

- Visual hierarchy: what the eye lands on first, and why.
- Affordances and feedback: does each control look like what it does, and does it answer when used?
- States: empty, loading, error, partial, and full, not just the happy path.
- Cognitive load, defaults, and progressive disclosure.
- Consistency through tokens and components, and when breaking it is right.
- Accessibility: contrast, focus order, keyboard use, and screen reader labels.

**Worth doing by hand:** sketching the layout before seeing options, writing the copy, and judging the result against the user's task.

## Artifacts and visuals

Pick the medium that gets the idea across with the least effort:

- **In code, with screenshots or recordings.** The default. Build it in the real app with real components, then show screenshots of each state, or a recording when the interaction matters. Verify it yourself before showing me.
- **Simple HTML in the thread**, when a rendered sketch is enough to compare options.
- **A design tool**, such as Figma, Paper, or Claude Design, when the design lives there. Work in that tool when it is connected, and say so when it is not.

For a critique, show the screen with each problem marked, ranked by how much it hurts the user's task.

One chunk is one screen, one state, or one component.

## Skills

- `prototype` (mattp): a throwaway UI to explore what a screen should look like.
- `principle-exhaust-the-design-space` (pstack, **I run it**): two or three competing designs for a novel interaction.
- `principle-experience-first` (pstack, **I run it**): user delight over implementation convenience.
- `html-communication` (jonasw): UI mocks as readable HTML.
- `product` template: when the open question is what to build, not how it looks.
- `programming` template: when the work turns into implementation.
