---
section: Fixed
commits:
  - fix(editor): share current project translations across the inspector and viewport
---
**The text inspector and viewport now agree when translation files override the same key.** Both use the runtime's project-path order for discovered tables and pick up edits that arrive during a read. Switching projects clears the previous project's keys. The preview language menu shows each language once and counts missing translations across its files. Editing a single table rereads only that file, and saving a scene leaves the loaded translations available.
