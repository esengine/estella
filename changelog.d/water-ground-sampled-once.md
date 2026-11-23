---
section: Changed
commits:
  - perf(water): the ground under a water zone is read in one pass, a hundred times faster
---
**A water zone reads the ground under it in milliseconds rather than a second.** Before its water is baked,
a zone reads the terrain's height at every texel, and each read looked the terrains up and fetched a
Transform through the engine again: about 0.9 seconds of main-thread work for the 1024 by 1024 zone of the
Terrain & Water example, longer while a scene loads. The terrains are now read once for the whole pass
(`TerrainsRes.heightSampler`): 7 milliseconds, the same heights.
