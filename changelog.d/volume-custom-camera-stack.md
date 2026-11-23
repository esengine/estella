---
section: Fixed
commits:
  - fix(render): preserve custom camera effects when volumes retire
---
**A camera keeps its custom effect stack when a post-process volume stops contributing.** Leaving a volume, switching to an overlay camera, or shutting down the volume system releases the effects that the volume created. A replacement stack that the scene or game has bound to the camera stays active.
