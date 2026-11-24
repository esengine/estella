---
section: Fixed
commits:
  - fix(render): scope skeletal passes to the app that owns the armature
---
**Spine and DragonBones characters stay in their own scene when a game and a preview share a renderer.** A character on a screen-space Canvas appears when its assets finish loading or it is enabled again. Closing a preview releases its drawing callbacks and cancels pending character bindings.
