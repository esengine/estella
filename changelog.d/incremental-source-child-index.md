---
section: Changed
commits:
  - perf(editor): update the source child index locally after reparenting
  - perf(project): ship incremental editor hierarchy indexing
---
**Moving several nodes between parents is faster in large scenes.** The editor updates the old and new sibling lists in scene order and reuses the child index for the rest of the scene.
