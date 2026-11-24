---
section: Changed
commits:
  - perf(ui): reuse sibling order for overlapping world picks
---
**Pointer picking is faster in scenes with many overlapping sprites, meshes or touch areas.** Native and web games reuse sibling positions within each pick when resolving ties in depth and sorting layer. Picking follows the current scene order after objects move between parents or siblings are reordered.
