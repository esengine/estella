---
section: Fixed
commits:
  - fix(scene): track scene arrivals from request through publication
---
**Scene readiness includes loads queued behind an outgoing scene.** Loading screens and frame-stepping tools can wait through retirement and setup for a load, switch, or reload. An exclusive request that joins an additive load activates the scene when it is ready. Cancelling an unfinished scene also stops its sprites and meshes from appearing when a delayed asset read completes.
