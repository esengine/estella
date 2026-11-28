---
section: Fixed
commits:
  - fix(picking): keep speculative component reads tracked
---
**Entity picking tracks mesh, parent and sorting-group reads during speculative steps.** Ray and area picks both use the world's tracked readers while a step can be rolled back. Ungrouped hits also avoid allocating temporary ancestry collections.
