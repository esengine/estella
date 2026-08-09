# Third-party assets

Celestial Heights ships publicly, in source and in packaged builds, on every
platform Estella targets. So every byte of art and audio in this project must
carry a licence that permits **public redistribution, commercial use, and
modification**, and must be recorded here before it is committed.

One row per asset or asset pack:

| Asset | Where it is used | Source | Licence | Attribution required |
|---|---|---|---|---|
| _(none yet — see placeholders below)_ | | | | |

## Placeholders in the tree

| File | Stands in for | Shape it commits to |
|---|---|---|
| `assets/textures/tileset.png` | the terrain atlas | 6 tiles, 64×64, one row, no margin or spacing; ids 1–3 walkable (grass, path, blossom), 4–6 solid (rock, water, wall) |

Actors are still untextured `Sprite` colour quads at their final sizes: Lyra
84×150, a wisp 64×96. Replacing any of these is a swap of the file plus the
licence row above — not a change to a scene or a system.

## Rules

- **No unlicensed placeholder survives a phase.** Programmer art is fine while a
  phase is in flight; it is shaped to the final asset (same dimensions, same
  slicing, same Spine animation names) so the swap is mechanical.
- **Nothing from `third_party/spine-runtimes-4.3/`.** Those example skeletons
  (spineboy, celestial-circus, …) are licensed for evaluating the Spine runtimes
  only. They may not be redistributed with a game. Not one file.
- **Attribution-required assets** get their credit line into the game's own
  credits screen, not only into this table.
- **Keep the source.** Record where a pack came from, not just its name — a
  licence you cannot produce later is a licence you do not have.
