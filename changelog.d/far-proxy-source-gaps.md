---
section: Changed
commits:
  - perf(world): skip cells in gaps between residency sources
---
**Large worlds spend less time reconciling cells between distant residency sources.** When far proxies cover the full near reach, the streamer rules out gaps between sources once for both paths and keeps exact distance checks for proxy placement.
