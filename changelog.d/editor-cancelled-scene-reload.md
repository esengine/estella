---
section: Fixed
commits:
  - fix(editor): preserve open scene assets during cancelled reloads
---
**An interrupted disk reload keeps the open scene's resources and streamed cells.** While the replacement loads, the editor keeps the current mesh, material, and texture bindings. When the reload is cancelled or asset resolution fails, the editor releases the replacement's preload.
