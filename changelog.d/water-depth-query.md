---
section: Added
commits:
  - feat(water): a water sample says how deep the water is down to the ground under it
---
**A water sample says how deep the water is.** `Waters.sample` now answers `waterDepth`: how far it is from the surface at rest down to the ground under it (a river's bed, a lake's floor), in world units. That is what wading, swimming and a boat running aground are decided by; `depth` still says how far the point itself is above or below the surface. Open sea with no ground known under it answers 1e6.
