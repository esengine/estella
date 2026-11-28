---
section: Fixed
commits:
  - fix(tilemap): honor atlas margins and spacing for Tiled tile objects
---
**Tiled tile objects sample their own atlas cell.** Object sprites account for the texture dimensions, border and spacing, and use the same half-texel inset as tile layers.
