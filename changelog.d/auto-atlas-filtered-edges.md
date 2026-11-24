---
section: Fixed
commits:
  - fix(pipeline): preserve filtered edges in packed texture frames
---
**Automatic atlas packing preserves filtered sprite edges.** The packer fills the padding around each image using its wrap and transparency settings. Bilinear filtering now picks up the source edge colour and opacity, removing dark fringes on scaled sprites and UI images.
