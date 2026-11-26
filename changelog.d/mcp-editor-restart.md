---
section: Fixed
commits:
  - "fix(editor): reopen the project when the MCP front restarts a dead editor, and say why"
---
**When the editor dies between two MCP calls, the next call opens the project again and says what happened.** Until now,
the front started a new editor without a word. That editor had no project open, so every later call answered "no project
open" and gave no reason. An agent took this to mean it had closed the project itself, and it had already lost its unsaved
placements without knowing. Now the front remembers which project the editor had open and reopens it in the new editor. The
call's answer then begins with the editor's exit code, the last lines it printed, and a warning that scene edits not saved
with `save_scene` are gone.
