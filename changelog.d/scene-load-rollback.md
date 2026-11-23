---
section: Fixed
commits:
  - fix(scene): roll back failed scene loads across authoring and runtime
---
**An interrupted scene load now releases its entities and asset references in both authoring and packaged games.** A retry can load the scene cleanly after prefab expansion, asset loading or a streamed spawn fails. Other scenes and callers keep their existing resources.
