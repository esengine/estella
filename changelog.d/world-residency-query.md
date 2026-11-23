---
section: Changed
commits:
  - perf(residency): narrow per-frame cell reconciliation
  - perf(residency): skip gaps between streaming sources
---
**Streamed worlds spend less time checking distant, idle cells.** Sprite and mesh worlds on web and native skip empty space between separated streaming sources while preserving streaming order, prefetch, unload hysteresis and far-proxy handover.
