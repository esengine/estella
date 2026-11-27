---
section: Fixed
commits:
  - fix(editor): preserve export scene names during Play
  - fix(project): reserve shipping scene names before editor-only names
---
**Play keeps the scene names used by project exports.** Editor-only scenes remain available during Play. If a name collides, the project startup scene and scenes in the configured scene directory keep their export names.
