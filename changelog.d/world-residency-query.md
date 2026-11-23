---
section: Changed
commits:
  - perf(residency): narrow per-frame cell reconciliation
---
**Streamed worlds spend less time checking distant, idle cells.** Sprite and mesh worlds on web and native use the same bounds check while preserving streaming order, prefetch, unload hysteresis and far-proxy handover.
