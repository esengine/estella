---
internal: A staggered unload goes through the same teardown function as every other unload and a failed load's rollback; what a scene gives back is unchanged.
commits:
  - refactor(scene): a staggered unload tears down through disposeSceneOwnedState_, which takes the retire step - unload had settled, despawned and finished on its own beside it, and scene-teardown could no longer see one protocol
---
