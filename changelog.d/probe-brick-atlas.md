---
section: Changed
commits:
  - perf(render): a probe volume read per pixel samples a 3D atlas of bricks through an indirection cell - nine filtered reads where it took eighteen, in the shape a sparse volumetric lightmap takes
---
**A probe volume read per pixel takes half the texture reads it did, from a 3D atlas of bricks.** A mesh without lightmap UVs inside a LightProbeVolume reads the grid where each pixel stands; the grid is now cut into bricks of 4x4x4 cells in a 3D texture, found through an indirection cell, and filtered by the hardware along all three axes: nine reads and one fetch per lookup instead of eighteen (a reflection that also asks the sky's visibility saves as many again). What a surface is lit with is unchanged. A dense grid's atlas is larger than before (the Bistro's 13x3x9 grid: 60 KB, from 25 KB), the cost of bricks that carry their own edges, which is what lets a later bake place bricks only where the light changes.
