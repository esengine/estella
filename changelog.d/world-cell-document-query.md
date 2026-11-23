---
section: Fixed
commits:
  - fix(runtime): read cooked cell paths through the active world view
---
**Packaged web builds read mesh preparation inputs from the active world.** A read-only cell query resolves each scene's own file when switching between worlds that use the same cell name.
