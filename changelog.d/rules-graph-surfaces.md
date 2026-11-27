---
section: Added
commits:
  - feat(pipeline): name what a rules graph part is made of, drawn with tiling textures at their real size
  - feat(editor): apply a rules graph with a material and texture for each surface it names
---
**A rules graph can say what each part is made of.** A `box`, `part`, `roof` or `beam` takes `surface`, and the graph's
`surfaces` table names a material, a texture and the length one repeat covers for each. Applying the graph packs each
surface into meshes of its own, with texture coordinates measured from the part's real size, so a roof's tiles and a
wall's plaster keep their scale on every building, and the part's colour still tints them.
