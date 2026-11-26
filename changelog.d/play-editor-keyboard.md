---
section: Fixed
commits:
  - fix(editor): keep keyboard focus with the active play session
  - fix(project): update the editor play focus lifecycle
---
**Reloading a preview keeps the keyboard where you were working.** You can keep typing in an editor field or controlling the same player after a script edit. Stopping an embedded game returns focus to the last editor control if it is still available. A late reply from a stopped preview can no longer bring its game view back.
