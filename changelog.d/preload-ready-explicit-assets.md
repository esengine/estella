---
section: Changed
commits:
  - perf(assets): share subpackage readiness scheduling for preloads
---
**Explicit asset preloads can warm ready resources while a minigame subpackage mounts.** Explicit lists and asset labels share load slot scheduling. Each listed occurrence keeps its own progress, failure reporting, and asset reference.
