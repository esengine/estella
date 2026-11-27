---
section: Changed
commits:
  - perf(terrain): reuse height bounds across page samples
---
**Terrain pages build faster in worlds with height modifiers.** Each page reuses its height range and applies only the modifiers whose bounds touch the sampled region.
