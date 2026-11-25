---
section: Fixed
commits:
  - fix(logic): spawn graph prefabs with the agent's scene and asset ownership
---
**Visual scripts can share a prefab across additive scenes with different texture settings.** Direct spawns and calls to another graph use the triggering agent's assets for sprites and meshes. Unloading the agent's scene removes the entire spawned hierarchy. Events use the updated prefab after an asset refresh and stop reaching a graph when its agent clears the reference.
