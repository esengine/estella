---
section: Fixed
commits:
  - fix(world): validate project entity references when exporting streamed worlds
  - refactor(editor): share project schema extraction with the build pipeline
---
**Streamed-world exports validate references declared by project components.** The cooker reads the current component declaration entry and rejects invalid cross-cell references with the field name and target cell. Valid links to persistent entities are recorded in the world manifest.
