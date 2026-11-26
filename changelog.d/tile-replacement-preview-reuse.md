---
section: Changed
commits:
  - perf(editor): reuse decoded chunks while adjusting tile replacement
  - perf(project): ship faster tile replacement parameter edits
---
**Adjusting a tile replacement reuses the layer’s decoded chunks.** The dialog recomputes the preview with the new parameters and
reads the tilemap again after a scene update.
