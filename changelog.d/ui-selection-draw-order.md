---
section: Fixed
commits:
  - fix(editor): share scene selection priority between Edit and Play
---
**Layout containers no longer take priority over visible objects.** Edit and Play prefer drawable UI and scene geometry before layout-only nodes. The UI Debugger still picks UI directly, including layout-only containers.
