---
section: Fixed
commits:
  - feat(editor): expose water mesh inspection and tiled water zone controls
  - fix(water): project wave caustics onto shared receivers and stitch visible water tiles
  - fix(editor): refresh water triangle counts as the viewport moves
  - fix(editor): pin the live water mesh diagnostics
  - fix(render): keep degenerate scale highlights out of underwater bloom
  - fix(editor): group water mesh labels with the Details inspector
  - fix(water): keep shore asset loading and material menu order consistent
  - fix(water): keep mesh inspection independent of optical passes
  - fix(editor): align water diagnostics and verify rendered wire edges
---
**Water tiles meet at the shoreline and sunlight follows the waves across the waterline.** Water zones expose rectangular extents, tile density, distance scaling, far water and two wireframe views. Rivers, lakes and oceans can use their own surface, junction and underwater materials. Wave speed respects project units. Sunlight projects through the current waves onto submerged objects and the bed, and unlit water no longer adds a fixed glow.

Fish scales with a collapsed texture direction fall back to an isotropic reflection at that pixel. Bloom ignores invalid radiance samples. Adjusting the light shafts on a volume preserves the water body's absorption and density.

The two editor wireframe views display the geometry above and below the surface without baking caustics or applying underwater fog.
