---
section: Fixed
commits:
  - feat(editor): expose water mesh inspection and tiled water zone controls
  - fix(water): project wave caustics onto shared receivers and stitch visible water tiles
---
**Water tiles meet at the shoreline and sunlight follows the waves across the waterline.** Water zones expose rectangular extents, tile density, distance scaling, far water and two wireframe views. Rivers, lakes and oceans can use their own surface, junction and underwater materials. Wave speed respects project units. Sunlight projects through the current waves onto submerged objects and the bed, and unlit water no longer adds a fixed glow.
