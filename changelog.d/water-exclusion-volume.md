---
section: Added
commits:
  - feat(water): an exclusion volume keeps the water out of a box
---
**Exclusion volumes keep the water out of a box.** A WaterBody set to **Exclusion Volume** is a box (its Size X and Z, or an outline, and a Size Y height) the water stays out of. Where the water's surface lies within its height the surface is not drawn over it, and a point inside it is not in water: no underwater look, no buoyancy, no depth answered. A box wholly under the surface keeps the surface above it, so a dry room under the sea, a boat's hold or a cave mouth reads as above water from inside while the sea stays whole over it.
