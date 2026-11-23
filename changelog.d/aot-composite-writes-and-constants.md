---
section: Changed
commits:
  - feat(aot): a compiled system writes a vector field whole and reads constants made of constants, and never folds a module let
---
**A `@compiled` system can write a vector field whole and use constants built from other constants.**
`transform.position = { x, y, z }` (and any vec, quat or colour field, on engine or project components)
compiles as one store per member, every member read before any is stored, so a swap swaps; leaving a
member out is refused with the line, because the interpreter would store `undefined` there. A module
`const` made of other constants and arithmetic (`const SPAWN_Y = HALF_HEIGHT + 60`, imported or not)
folds into the code. A module `let` is no longer folded as if it were a constant: a compiled system
reading one used the value it had when the game was built, while the interpreter read the live one;
it is now refused, as module state is. Per-frame systems in the examples that compile: 16 → 20 of 174.
