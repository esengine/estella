---
section: Changed
commits:
  - perf(ui): skip repeated wheel picks without a scroll target
---
**Wheel input over non-scrollable areas does less hit testing.** Consecutive samples at the same position reuse a miss within the batch. A scroll or a changed position prompts a new hit test.
