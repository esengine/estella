---
section: Fixed
commits:
  - fix(editor): preserve scene save state past the undo limit
  - fix(project): ship reliable scene save state past the undo limit
---
**Scene save state survives a full undo history.** Editing other assets can push earlier scene actions out of the undo list. Those edits still count when the editor decides whether to save the scene on close or ask before reloading it from disk.
