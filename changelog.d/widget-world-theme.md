---
section: Fixed
commits:
  - fix(editor): read preview themes from the packaged project settings
  - fix(ui): resolve widget colors in their owning world
---
**Dropdowns created from prefabs now match the project’s widget palette.** Play and exported games apply the theme to both scripted and prefab widgets, including those spawned later. Restarting Play picks up the current project settings, and switching scenes preserves a theme chosen in game.
