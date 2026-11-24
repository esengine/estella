---
section: Fixed
commits:
  - fix(pipeline): preserve texture precision and colour when cooking mip chains and atlases
---
**Compressed atlas pages now ship the mip levels and colour space their images request.** Disabling mipmaps omits the smaller levels from the package. The encoder averages sRGB artwork in linear light, preserving brightness at a distance. Images marked Data and 16-bit PNGs in atlas folders use the lossless texture cook. Data textures also sample as linear when older metadata still has sRGB selected.
