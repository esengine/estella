---
section: Fixed
commits:
  - fix(assets): preload registered component dependencies with their scene
---
**Scenes now preload the assets declared by project components and terrain layers.** Missing files appear in scene loading reports. Persistent entities, entities adopted by another scene, and prefab instances keep their declared lists of assets until destruction. Components can also declare a scalar JSON data field. Named registry entries that share a packaged file stay independent across scene, group, label and explicit loads. Terrain releases its temporary layer reads after packing.
