---
section: Changed
commits:
  - perf(world): sort load and prefetch candidates together
---
**World streaming sorts its queues once per update.** Loading and prefetching share the same nearest-first sort and keep their own eligibility rules. Tied cells still follow manifest order.
