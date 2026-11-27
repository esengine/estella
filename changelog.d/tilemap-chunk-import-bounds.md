---
section: Fixed
commits:
  - fix(tilemap): preserve layer bounds when loading saved chunks
---
**Saved tile chunks respect layer bounds.** Importing clips tiles to the bounds of a finite layer. A saved map with cells outside the supported coordinate range is rejected before the layer's tiles are replaced.
