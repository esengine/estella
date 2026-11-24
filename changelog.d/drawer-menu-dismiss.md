---
section: Fixed
commits:
  - fix(editor): a menu opened in the Content Drawer closes when you click elsewhere in it
---
**A menu opened in the Content Drawer closes when you click elsewhere.** A right-click menu, dropdown or popover opened
inside the Content Drawer (or the agent drawer) stayed open after a left click anywhere else in the drawer: the drawer
swallowed every press inside it so as not to close itself, and the menu never heard the click. The drawer now closes
only on a press on the dimmed area around it, and menus inside it close as they do everywhere else.
