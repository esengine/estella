---
section: Changed
commits:
  - feat(render): the GI and reflection loop counts, grids and bakes take their size from the quality level
  - feat(render): a level holds a planar reflection's own values under its own, GTAO keeps two slices, and the docs measure the GI and reflection rows
  - feat(render): screen-space GI denoises in a 3 x 3 square at Medium, measured on screen against 5 x 5
---
**Global Illumination & Occlusion and Reflections hold the samples, steps, grids and bakes those effects spend.** What the
shaders and the engine had written in is now a row of the level's table, with High at the value it always had: SSAO samples,
GTAO slices and steps, the ambient occlusion blur radius, screen-space GI rays, steps and denoise width, screen-space
reflection steps and refinement, the voxel GI grid, sun samples and bounce rays, the Dynamic GI probe rows (no longer fixed
by platform: 45 rows on Android and 90 elsewhere is now 30, 45 and 90 by level), its distance field's size and the time it may
spend rebuilding a frame, how often the sky is baked into the scene's light, the size of that bake and of the reflections it
gives, its cloud steps, and the face size a capturing light probe volume draws. A planar reflection with its own (Custom)
scale, size or rate is now held under the level's values while a level is in force, and Low redraws planar reflections at
most 30 times a second; with no level in force a Custom reflection keeps its own values.
