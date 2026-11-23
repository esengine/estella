---
section: Added
commits:
  - feat(groom): several meshes in one preview, and a colour per group for the Strands shader
  - feat(editor): a Groom editor, the strands previewed beside a Strands panel of each group's figures and settings
---
**A groom opens in its own editor.** Double-click a `.esgroom` in the Content Browser: the strands are drawn on the left, turned by
dragging, lit as the game draws them or each group in a colour of its own (Groups); on the right, the Strands panel gives every group a
bar in that colour, its figures (curves and points of the strands and the guides, the widest strand, points per curve from fewest to
most, the attributes the curves carry) and its settings: Material, Hair Width, Hair Root Scale, Hair Tip Scale, Hair Shadow Density,
Cast Shadows and Stable Rasterization. An edit shows at once; Save writes the `.esgroom`, and Reload Curves reads the curves again
after a new export from Blender. For code, `renderMeshSetPreview` draws several meshes, each with its own material, in one preview.
