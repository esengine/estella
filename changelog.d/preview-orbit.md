---
section: Added
commits:
  - feat(render): previews take the angle they are seen from
  - feat(editor): turn the Details mesh and material previews by dragging
---
**Turn a mesh or material preview by dragging it, as in Unreal.** In Details, drag the preview of a mesh, or of a material shown on a sphere or cube, to turn it: sideways turns it around, up and down tilts it. Double-click puts it back to the usual angle. A material that no scene uses no longer shows an empty preview: the preview waited for no shader, and a material loaded only to be previewed was always still compiling.
