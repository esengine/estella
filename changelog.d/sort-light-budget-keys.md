---
section: Changed
commits:
  - perf(render): rank light budgets without moving collected lights
---
**Scenes that exceed the light budget sort smaller records per view.** The renderer keeps the same priority and tie order, and skips lights with non-finite intensity.
