---
section: Fixed
commits:
  - fix(render): keep drawing callbacks and scene fades with their world
  - fix(editor): bind viewport guides to the active editing world
---
**Simultaneous worlds can draw their own HUDs and scene fades.** Two scenes can use the same callback name, and closing one leaves the other's overlays on screen. Editing guides, terrain brushes and selection handles follow the editing world when the viewport restarts.
