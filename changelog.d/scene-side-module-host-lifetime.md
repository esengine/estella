---
section: Fixed
commits:
  - fix(scene): release retired physics module hosts
---
**A running game can reclaim a replaced physics module host and its cached modules.** Scenes that return to a previous host while its download is still in flight share that download.
