---
section: Changed
commits:
  - perf(assets): skip handle binding for hidden scene entities
---
**Hidden scene entities keep their authored asset references during scene preparation.** Scene loading and editor preview now skip resolving asset fields for hidden entities, matching the existing preload and spawn behavior.
