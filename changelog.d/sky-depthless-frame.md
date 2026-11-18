---
note: Cut-out foliage in front of the ground no longer has a pale line round every leaf
commits:
  - fix(postprocess): a sky over a frame that kept no depth is drawn again - with nothing drawn into depth the scene keeps no depth target and its unit reads 0, which the cut-out edge fix counted as surface on every side of every pixel, so Sky Atmosphere and a custom sky drew nothing over a bare sky; a neighbour is surface only where its depth lies strictly between the near and far planes
---
