---
section: Changed
commits:
  - perf(editor): project only nearby cells in large tile paint previews
---
**Large tile paint previews generate fewer off-screen outlines.** Isometric, staggered, hexagonal and rotated grids with an affine view use the visible tile range for selection and paint previews. Painting and undo still use the full gesture.
