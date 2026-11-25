---
section: Fixed
commits:
  - fix(editor): author registered animation and graph names in asset slots
  - fix(assets): preserve registered names across scene and motion loading
---
**Animation and graph pickers accept names registered by game code.** The inspector shows registered names alongside project files. Folder paths and the registered-name label stay legible on the selected row in both list and grid views. A sprite clip called `Game.Walk` or a timeline called `Rig/Turn` keeps its spelling in the edit viewport and plays by that name in exported scenes and Animator controllers. Files identified by type without a standard extension also load and ship.
