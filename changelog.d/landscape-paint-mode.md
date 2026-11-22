---
section: Added
commits:
  - feat(terrain): paint and compose named landscape material weights
  - feat(editor): author landscape material weights and layer information
  - fix(editor): finish orphan deletion across weightmap reloads
---
**Landscape Paint can paint, smooth, flatten and add noise to a material layer.** The viewport supports rectangular selections, inverse masks and stroke undo. Named layer information can be shared between terrains and defines weight blending, independent opacity, erosion hardness and physical material. Removing a painted layer from a material keeps its weightmap channel until the author deletes it.
