---
section: Fixed
commits:
  - "fix(scene): keep imported particle scaling and textures in sync"
---
**Imported particle emitters keep their texture references and follow model scale.** Replacement emitters receive the authored size and force conversion even when the model scale stays the same. Steady frames skip the scan when transform and particle inputs are unchanged.
