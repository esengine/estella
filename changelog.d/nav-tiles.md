---
section: Fixed
commits:
  - fix(nav): a streamed world's navmesh is baked a tile per grid square and follows its cells - it was baked once from the persistent world before any cell arrived and never again, so agents walked straight through every wall a cell held
---
**Agents in a streamed world walk round what its cells hold.** A streamed world's NavVolume was baked once, from the persistent world, before any cell had arrived, and never again: every wall, building and rock a cell held was missing from the navmesh, and agents walked straight through them. The volume is now baked a tile per square of the world's grid, from the colliders in and around that square, and a tile is baked again when a cell reaching it arrives or leaves (two tiles a frame); the tiles are joined into one mesh a route crosses without seeing the seams. Agents walk only where the world is loaded: a square whose cell is not resident has no tile, so a route there ends at the edge of what is loaded. A scene that is not streamed is baked once, as before. `__estellaCooked.pathBetween` in a package's headless hook now passes z, so it answers for a 3D navmesh.
