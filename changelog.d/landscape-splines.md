---
section: Added
commits:
  - feat(editor): author landscape spline networks in the terrain tools
  - feat(terrain): grade landscapes and deform static meshes along spline networks
  - fix(terrain): subdivide long road mesh edges through spline bends
  - fix(editor): preserve landscape spline asset references in the edit world
  - fix(editor): shape landscape control point markers like terrain peaks
---
**Landscape roads, paths and junctions can now be authored in Manage → Edit Splines.** Extend or split curves in the viewport, edit their tangents and shoulders, and assign static meshes to control points or connected segments. Apply the roadbed and its painted layer together, including across streamed terrain tiles, with one undo step.
