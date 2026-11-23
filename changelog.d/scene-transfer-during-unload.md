---
section: Fixed
commits:
  - fix(scene): preserve cross-scene ownership during unload and rollback
---
**Entities can move between scenes while a streamed cell unloads.** Transferred sprites and meshes keep their assets, visibility and world transforms. Unloading a scene or rolling back a failed load preserves another scene's children, including those attached through temporary hierarchy nodes. Custom unload hooks can use `SceneRetirement.despawn` to check ownership when each entity's turn arrives.
