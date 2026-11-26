---
section: Fixed
commits:
  - fix(editor): keep long action menus inside the viewport
---
**Long editor action menus fit inside short windows.** The Hierarchy and Inspector use the same row styling and keyboard focus as the editor’s dropdowns. You can scroll to the final command, follow a submenu near the edge of the window, and press Escape to return to its parent.
