---
section: Changed
commits:
  - perf(world): track occupied streaming slots on residency changes
---
**World streaming spends less CPU time scheduling a large queue of cells.** Preparation and publication limits use counts updated at each residency transition, so checking a queued cell no longer scans the world.
