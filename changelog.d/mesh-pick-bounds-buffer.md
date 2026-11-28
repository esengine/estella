---
section: Changed
commits:
  - perf(picking): reuse the mesh bounds buffer across a selection
---
**Selecting objects in mesh-heavy scenes spends less time retrieving geometry bounds.** Single selection, selection cycling, and box selection reuse a temporary bounds buffer while reading the current geometry of each mesh.
