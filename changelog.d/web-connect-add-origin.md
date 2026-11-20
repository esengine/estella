---
section: Fixed
commits:
  - fix(editor): Add Origin in the Web packaging page adds a row to type into
---
**Add Origin on the Package Project dialog's Web page works.** Clicking it did nothing: the new row was blank, and a blank origin was saved straight away and dropped as not an origin. The row now stays in the list, asking for an origin until one is typed, and the origin typed is saved with the project.
