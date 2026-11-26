---
section: Fixed
commits:
  - fix(ui): make dropdown chevrons legible and dismiss one overlay at a time
---
**Dropdowns show their open state with a clearer chevron and close one layer at a time.** The built-in widget and editor prefab draw the arrow at a consistent size in either theme. Escape and tapping a dialog backdrop dismiss the open list first. Selecting a row keeps keyboard focus on its button. In nested dialogs, each Escape reaches only the innermost visible dialog in the focused branch. Opening a child dialog also removes its parent's floating list.
