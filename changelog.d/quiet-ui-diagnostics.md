---
section: Fixed
commits:
  - fix(diagnostics): drop the layout notice from every well-formed UI node
  - fix(editor-mcp): say when a stale editor build is someone's uncommitted edit
---
**`get_diagnostics` no longer flags every UI node.** Each node made by `apply_scene_ops` carried a "position owned by UI
layout" notice, so a HUD could never come back with an empty list; the notice now appears only for a node moved by its
Transform, and diagnostics are in English whatever language the editor shows. The note that the editor build is stale says
when the cause is an uncommitted edit in the engine checkout rather than anything in the project.
