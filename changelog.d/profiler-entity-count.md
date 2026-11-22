---
section: Changed
commits:
  - perf(profiler): read the live entity count without copying the scene
---
**Sampling the profiler costs less in large scenes.** The editor's Play view and connected devices read the live entity count directly when reporting frame statistics.
