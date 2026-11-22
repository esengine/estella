---
section: Changed
commits:
  - perf(ecs): streamline animated component writes across runtimes
---
**Writing animated sprites and transforms takes less CPU time.** Timelines and blended poses share the component write path with the editor and game scripts. Web builds pass numeric fields directly to the registry. Native builds write the same values through their component buffers. Both paths fill missing fields from the project defaults.
