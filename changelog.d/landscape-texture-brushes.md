---
section: Added
commits:
  - feat(editor): match landscape brush details and add texture and component tools
  - feat(terrain): project texture masks and edit individual terrain patches
  - fix(terrain): bound component dirty regions and respect brush material capabilities
---
**Landscape brushes can stamp or tile a texture channel and edit a single terrain patch.** Sculpt and Paint share a compact property table with the viewport palette. Alpha stamps can follow the stroke direction. Pattern scale, rotation and offsets stay anchored to the ground. The viewport shows the selected mask or the snapped patch as you work.
