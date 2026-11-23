---
section: Fixed
commits:
  - fix(export): install the minigame host before project scripts run
---
**Mini-game project scripts can read the host during module initialization.** Exports install the selected platform before evaluating the project, so a module that reads input capabilities, language or storage at startup also works on hosts such as Douyin.
