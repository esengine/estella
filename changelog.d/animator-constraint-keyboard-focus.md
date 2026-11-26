---
section: Fixed
commits:
  - fix(editor): keep keyboard focus through animator constraint edits
  - fix(editor): ship keyboard controls for animator constraints
---
**Animator constraints can be expanded and edited by keyboard.** Adding a constraint focuses the new row. Removing one moves focus to a nearby row and preserves the expanded state of the remaining constraints.
