---
section: Changed
commits:
  - perf(ui): reuse wheel picks while the scroll offset holds
---
**Repeated wheel events at a scroll limit do less hit-testing.** A burst at the same position reuses its target until the content moves, while each event can still reverse the scroll immediately.
