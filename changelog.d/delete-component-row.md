---
section: Fixed
commits:
  - fix(editor): Delete on a component's row removes the component, not its entity
---
**Delete on a selected component removes that component, not the whole entity.** With a component's row picked in the Details component tree or under its entity in the Outliner, Delete (or Backspace) used to delete the entity. It now removes the component, as the row's menu does, in one undo step. In Details the entity's row takes the focus afterwards, so a second Delete is the entity's.
