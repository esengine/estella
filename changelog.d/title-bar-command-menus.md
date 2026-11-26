---
section: Fixed
commits:
  - fix(editor): keep scene shortcuts out of title bar menus
  - fix(editor): ship shared title bar command menus
---
**Browsing a title bar menu keeps Delete, Duplicate and Undo from changing the scene underneath.** Use the arrow keys to open and switch menus, and Escape to return to the current menu button. Ctrl+Space leaves the highlighted choice alone. View flags have checkboxes and the active pivot mode has a single selection mark. Long commands wrap and scroll within the window. In editable inspector dropdowns, clicking the next property commits the typed value and Escape cancels it.
