---
section: Fixed
commits:
  - fix(editor): use visible active supports for floor drops
  - perf(picking): share mesh bounds traversal with preview and editor
---
**Drop to Floor lands on visible, active meshes.** Hidden or disabled platforms no longer hold objects in the air. Locked platforms can still support a drop. Batch drops and scene preview framing reuse the engine's mesh bounds buffer.
