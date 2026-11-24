---
section: Fixed
commits:
  - fix(renderer): apply texture import sampling to compressed engine uploads
---
**KTX2 textures use their authored filtering and wrapping on WebGPU and native targets.** Pixel art keeps nearest filtering when magnified and when sampled from smaller mip levels. Turning off mipmaps uploads only the base level, and textures decoded to RGBA use the same sampling settings.
