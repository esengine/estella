---
section: Added
commits:
  - feat(water): an exclusion volume keeps out every body overlapping it or only those it lists, and a package with no water no longer carries the water body's definition
---
**Exclusion volumes that name their bodies.** A WaterBody exclusion volume's **Exclude All Overlapping Water Bodies** (on, as before) keeps every body whose water overlaps it out; off, it keeps out only the bodies in **Water Bodies to Exclude**: inside it their water is not drawn and a point is in none of it, while any other body runs on through (a box that keeps a pond out still holds the sea round it). Details lists the volume only under the bodies it keeps out. A mini-game package that uses no water also no longer carries the WaterBody definition and its descriptions (about 15KB).
