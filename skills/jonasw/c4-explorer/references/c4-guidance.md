# What follows C4, and what the explorer chooses

Checked against the official C4 site on 2026-10-17. These are the project's
implementation decisions and limits, not a certification or a copy of the
official specification.

## Sources and their implications

| Official source | What it establishes | Explorer behavior |
| --- | --- | --- |
| [Diagram levels](https://c4model.com/diagrams) | Context, container, component, and code are different abstraction levels. Use levels that add value. | View metadata records the abstraction explicitly. The fixture offers all four; a real model does not have to. |
| [Container diagrams](https://c4model.com/diagrams/container) | One software system is the scope. Its applications and data stores are primary elements; directly connected people and systems provide context. | A named system boundary contains its containers. Supporting systems appear outside it. A container does not mean a Docker container. |
| [Component diagrams](https://c4model.com/diagrams/component) | One container is the scope. Its components are primary elements. Related containers, people, and systems may supply context. | The Order API boundary contains four components. The database and broker retain their container identity outside it. |
| [Code diagrams](https://c4model.com/diagrams/code) | A component can be decomposed into selected classes, interfaces, functions, or similar code elements. This level is optional, and source generation is preferred when practical. | Each demo component links to an illustrative class/interface view. These are authored examples, not an extracted implementation. |
| [Notation guidance](https://c4model.com/diagrams/notation) | C4 does not prescribe one notation or palette. It recommends clear titles/scopes, element types, descriptions, relevant technologies, directional relationships with intent labels, and a key. | The explorer supplies those labels and a key. It wraps relationship intent instead of truncating it to a verb. Symbols, colors, grid placement, and animations are local choices. |
| [Review checklist](https://c4model.com/diagrams/checklist) | Review whether the audience can understand element, relationship, and notation meanings. | Use the checklist as a human review aid. Schema tests and browser tests verify narrower properties. |

## Meaning of the UML-style symbols

The two small tabs on an L3 element are a component symbol. They do not imply
that the element already contains a class diagram. Its L4 child view is a
separate diagram scoped to that component.

The L4 fixture shows class/interface names and selected attribute and operation
compartments. `+` means public; `-` means private. Dependency lines use dashed
open arrows. Interface realizations use dashed lines with hollow triangles
pointing toward the implemented interface. A legend states these choices.
This is a small UML-style notation subset, not a general UML modeling engine.

The component boundary in an L4 view is an explorer annotation describing its
C4 scope. It is not a claim that UML class diagrams require that boundary.

## Deliberate implementation choices

- Shapes make types visibly different, and remain stable across views. C4 does
  not require these particular shapes, sizes, colors, or SVG construction.
- The grid and gutter router are custom. There is no C4-mandated grid or
  animation algorithm. The current router has no general obstacle solver,
  parallel-edge lanes, self-loops, or guaranteed overlap-free dense layout.
- Code navigation and the native detail dialog are explorer interactions.
  C4's optional code level does not require every component to be clickable.
- Selected runtime flows use numbered arrows and an ordered relationship list.
  Static dependencies and runtime steps remain separate model fields.
- The fixture is fictional. No implementation files establish that its classes,
  dependencies, or behaviors exist in a real service.

## Verification limits

Core checks validate types, local relationship references, containment,
paging, visible budgets, complete label wrapping, and the four fixture code
views. Browser checks exercise actual clicks, focus, inspector visibility,
class members, and return navigation. Visual review checks the authored
fixture at selected widths and themes.

These checks do not prove that an arbitrary architecture is accurate, that
every C4 recommendation has been satisfied for every audience, or that a
large densely connected model will route cleanly. Review a real model against
its source and audience before making those claims.
