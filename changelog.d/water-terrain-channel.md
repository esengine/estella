---
section: Added
commits:
  - feat(water): a lake or a river cuts the terrain along a Curve Channel of its own
  - feat(editor): Details lists the islands, exclusion volumes and zone acting on a body of water
---
**Terrain settings on a body of water.** A WaterBody's new **Terrain** settings say how it changes the ground. **Affects Terrain** turns a lake's floor, a river's bed and an island's ground off and on. **Channel Shape** keeps the built-in cut or uses a **Curve Channel**: an **Elevation Curve** (an S by default) across a **Curve Ramp Width** from the shore, starting **Channel Edge Offset** in from it (negative out on the bank), to the body's Bed Depth (a river's, its points' Depth); laid over the terrain as **Min** (only cuts), **Max** (only raises) or **Alpha Blend** (either way), its bank running back into the ground over **Falloff Width**, the whole moved by **Z Offset**, and stepped by **Terraces** (alpha, spacing, smoothness). Details also lists, read-only, the **Water Body Islands** and **Water Body Exclusion Volumes** over a body and its **Owning Water Zone**, and `Waters.influencesOf(entity)` answers the same at run time.
