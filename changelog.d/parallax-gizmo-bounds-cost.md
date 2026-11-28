---
section: Changed
commits:
  - perf(picking): resolve parallax draw offsets without rebuilding bounds
  - perf(editor): reuse engine draw offsets for selection gizmos
---
**Transform handles update faster for large selections with parallax.** The editor reads each mesh bound or parented sprite matrix once while computing the handle offsets, preserving alignment between the handles and the selection outline.
