---
section: Fixed
commits:
  - fix(lighting): align scene light reports with runtime activity
---
**Lighting reports respect disabled scene hierarchies.** The editor and lightmap environment selection skip lights beneath disabled entities and lights with non-finite intensity. The studio preview also recognizes flat ambient light when the scene has no usable sky asset.
