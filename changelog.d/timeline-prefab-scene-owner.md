---
section: Fixed
commits:
  - fix(timeline): keep prefab spawn tracks with their player across additive scenes
---
**Timeline spawn tracks give their prefab instances to the player's scene.** Unloading a HUD leaves another scene's effects alive, even when their attachment parent was in the HUD. Game code can pass `owner` to prefab instantiation or a prepared spawn. An asynchronous request follows its owner across a scene transfer and cancels if that owner disappears. Removing and re-adding a clip discards the earlier pending preparation.
