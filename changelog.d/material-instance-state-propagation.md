---
section: Changed
commits:
  - perf(material): reuse resolved state when updating material instances
---
**Updating a material with many instances takes less CPU time.** Each instance builds on its parent's resolved state while preserving local overrides and shader defaults.
