---
section: Changed
commits:
  - perf(world): share the near and far residency bounds pass
---
**Large streamed worlds check distant cells once per residency update.** Near scenes and far proxies share the initial bounds check. Active proxies still finish loading, release assets, or unload as the sources move.
