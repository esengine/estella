---
section: Changed
commits:
  - perf(terrain): avoid per-pixel views when splitting paint maps
---
**Splitting painted terrain samples its weight maps faster.** Conversion reuses the source columns and copies the four channels directly, preserving their values in the overview and across tile edges.
