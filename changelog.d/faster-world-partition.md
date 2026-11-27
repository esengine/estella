---
section: Changed
commits:
  - perf(world): accumulate cell bounds during subtree placement
---
**Large streamed worlds partition faster.** Play preview and export now build cell bounds during the hierarchy walk, avoiding a separate position lookup for every entity.
