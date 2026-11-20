---
section: Changed
commits:
  - feat(editor): the LOD Group inspector is a bar of its levels, as Unity's is
---
**The LOD Group inspector shows its levels as a bar, as Unity's does.** Each level is a coloured segment across the screen sizes it is drawn at, ending in Culled; drag a boundary (or use the arrow keys on it) to move where a level takes over, and click a level to preview it in the viewport. A marker shows how large the object is on screen now, and the level being drawn is marked. Under the bar, a row per level gives its mesh, its screen size and its triangles against LOD 0's.
