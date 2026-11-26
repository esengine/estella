---
section: Fixed
commits:
  - fix(terrain): preserve PNG data channels on non-DOM hosts
---
**Terrain PNGs preserve their stored samples on hosts without browser image APIs.** The shared data decoder reads all 16 bits of
grey heightmaps and preserves the colour channels of weight maps even when a weight map’s alpha channel is zero.
