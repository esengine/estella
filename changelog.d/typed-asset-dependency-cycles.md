---
section: Fixed
commits:
  - fix(assets): track dependencies across registry slots and prepared generations
---
**Circular material inheritance reports the two materials as soon as the cycle is found.** A script graph can prepare the usable parts of a prefab whose agent points back to it. A hot edit that would make a graph own its live prefab keeps the last working graph. Concurrent readers of a material or mesh receive a live generation even if its previous holder releases it during loading.
