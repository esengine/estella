---
section: Changed
commits:
  - perf(editor): aggregate selection bounds without visiting corners
  - perf(render): share and streamline bounds aggregation for framing
---
**Large selections and asset previews use faster framing bounds.** Both use the same calculation for rotated sprites and meshes, with less work per object.
