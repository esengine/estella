---
section: Added
commits:
  - feat(render): view distance, terrain, water and texture costs the engine had written in are settings of the quality level - an LOD distance scale, the occlusion grid and the batch scan interval; detail distance reaching terrains, planets and Foliage, the terrain surface page size and pages a frame, the page atlas, planet draw levels, the voxel rebuild budget and the plants that bend; underwater shaft steps, water reflection steps and caustic layers, each loop compiled at its High count and stopped by the level; texture streaming's sizes, delays, pace and textures at once, the idle render-target budget and terrain tile memory. High keeps every value it had. How many loads run at once and what a generated world caches are project runtime settings instead
  - feat(settings): Project Settings -> Game -> Runtime has a Loading & Streaming group - scene preload at once, chunks made at once, ground pages asked at once, planet surface tiles kept, the world plan cache and the plans a planning worker keeps, each written to project.esproject only where it differs from the engine's value
  - fix(render): Low's underwater light shafts walk 16 steps, not 12 - at 12 the per-pixel jitter left a fine regular grain on what lies under the water, which a full-resolution pass has nothing to smooth, and a 4 x 4 ordered offset in its place drew a plain grid
---
**Four quality groups gain the costs that were written into the engine: View Distance & Draws, Terrain & Foliage, Water, and Textures & Memory.**
A level now says how far every LOD Group and impostor keeps its finer levels (LOD distance scale: 0.6 at Low, 0.8 at Medium),
how fine the CPU occlusion grid is, and how often merged models and static batches are scanned. Detail distance, which shortened
only grown plants, now also shortens a terrain's and a planet's finest cells and a Foliage field's draw and LOD distances; beside
it are the terrain surface page size (the fixed minigame half size is now Low's), the pages baked a frame, the terrain and planet
page atlas (1024 at Low), the most levels of a planet drawn (its collision keeps its own cell size), the voxel rebuild budget and
how many plants bend at once. Water gains the underwater shaft steps (16, 16, 24), the reflection steps seen from above (8, 12, 20)
and the caustic layers (2, 3, 3). Textures & Memory gains texture streaming's smallest and starting sizes, its delays, its pace and
how many textures it moves at once, the render targets kept idle (64, 128, 256 MB) and a tiled terrain's tile memory. High is what
the engine drew before. How many loads run at once and what a generated world caches follow the network and the package rather than
the device, so they are project settings instead: Project Settings → Game → Runtime → Loading & Streaming.
