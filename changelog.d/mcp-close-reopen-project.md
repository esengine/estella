---
section: Added
commits:
  - feat(editor): close and reopen a project from MCP through the menu's own door
---
**An agent can close the open project, or close it and open it again from disk, with `close_project` and `reopen_project`.** Both refuse while anything is unsaved unless they are passed `discardChanges`, as `open_scene` does, and `open_project` now refuses the same way instead of dropping the open project's unsaved changes. File > Close Project and the tools go through one door, which also writes the workspace down and lets go of the project in the editor's main process, so a closed editor no longer tells MCP clients it still has the project open (issue #243).
