---
section: Fixed
commits:
  - fix(postprocess): a cut-out's edge is no longer lit by the sky - the sky effects read a pixel's alpha as how much sky shows through it, and a cut-out leaf holds its coverage there, so every leaf in front of the ground was drawn with a pale line round it; a pixel with surface on every side of it is now surface whatever its alpha says
---
**Cut-out foliage in front of the ground no longer has a pale line round every leaf under Sky Atmosphere or a custom sky.** The sky effects add the sky to a pixel by what is left of its alpha, which is right where a surface's edge meets the sky and wrong for a cut-out (`alphaCutoff` with coverage), whose feathered edge is stored in the alpha while the ground stands behind it. A pixel whose four neighbours are all surface is treated as surface. It showed most with antialiasing off, where every leaf of a wood was outlined in the sky's colour.
