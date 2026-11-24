---
section: Fixed
commits:
  - fix(pipeline): stream authored KTX2 textures from their shipped mip levels
---
**Web builds can show a mesh using a small preview of an imported KTX2 texture before downloading the full texture.** UASTC and ETC1S previews preserve the mip levels stored by the artist. When the smaller levels are missing, the exporter generates a preview from the texture, including when project texture compression is off.
