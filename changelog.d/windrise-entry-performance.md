---
section: Fixed
commits:
  - perf(examples): shorten Windrise startup and reduce meadow rendering cost
---
**Windrise opens faster and draws fewer triangles during exploration.** The Web build compiles its first-view shaders in parallel on supported browsers while the loading screen is visible. Distant trees use simpler branches and foliage, grass patches drop out with distance, and scene-sized textures avoid large uploads during a walk. The local preview compresses game data and caches content-addressed assets.
