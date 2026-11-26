---
section: Fixed
commits:
  - fix(scene): preserve failed asset refs when spawning prepared documents
---
**Loaded scenes and prepared prefabs retain failed asset references.** The inspector and scene snapshots keep the authored texture or mesh path for retry. Spawning the scene does not request the same missing asset again.
