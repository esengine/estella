---
section: Fixed
commits:
  - fix(scene): bind scene publication and rollback to their owning world
---
**Closing or replacing a world during scene loading preserves entities in the new scene.** Interrupted loads release their partially spawned entities and acquired assets. A reopened preview keeps its sprites and meshes even when the new world reuses the same entity numbers. The new world can start its physics subsystem while the previous world is still waiting for its module.
