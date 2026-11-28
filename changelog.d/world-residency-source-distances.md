---
section: Changed
commits:
  - perf(world): skip exact distances to out-of-range residency sources
---
**World streaming spends less time comparing distant sources.** Cells outside a source's reach can skip the exact distance calculation. The streamer still uses the nearest source to prioritize loading and prefetching.
