# Tilemap Demo

Estella's tilemap system, shown two ways — **a Tiled `.tmj` import** and **an
engine-native `.estileset`** — over the same Kenney Pixel Platformer art, plus
three **orientation showcases** (isometric, staggered, hexagonal) painted natively
in the editor. Everything is drawn by the built-in tilemap plugin with **no
gameplay code**; the levels live entirely in the scene/assets.

| Scene | Authoring path | What it shows |
| --- | --- | --- |
| `assets/scenes/tiled-map.esscene` *(default)* | `Tilemap { source: "…/level.tmj" }` | Imports a real [Tiled](https://www.mapeditor.org/) map: **two embedded tilesets** (`terrain` + `props`, global GIDs), a **parallax** background of clouds, **animated** water, and **per-tile collision** — the map is auto-loaded when the scene opens. |
| `assets/scenes/native-map.esscene` | `TilemapLayer` → `.estileset` | References the engine's first-class tileset asset. Collision and the water animation are **derived live at runtime** from the tileset — nothing is baked into the scene but the tile chunks. |
| `assets/scenes/iso-map.esscene` | `TilemapLayer` · **isometric** | A diamond-grid island — water border, sand beach, grass, forest, and a stone clearing. |
| `assets/scenes/staggered-map.esscene` | `TilemapLayer` · **staggered** | The same diamond tiles in a staggered-isometric layout, with a river winding across the patchwork. |
| `assets/scenes/hex-map.esscene` | `TilemapLayer` · **hexagonal** | A pointy-top hex strategy map — a lake with a sandy shore, forest, and a snow-capped mountain range. |
| `assets/scenes/wang-map.esscene` | `TilemapLayer` · **corner-Wang terrain** | A grass island → sand beach → water sea whose transitions are **auto-tiled** by a corner-Wang set — paint a terrain color and the borders blend on their own. |

## Corner-Wang terrain (auto-tiling)

`wang.estileset` carries a **corner (Wang) terrain set** with three colors — grass,
sand, water. Each tile assigns a color to its four corners (the colored dots in the
Tileset editor's Terrain mode), and the painter's **terrain brush** picks the tile
whose corners match, so painting one color **blends into its neighbours automatically**
— the classic "circle in the four corners" technique, with **many terrains in one set**.
Author your own with **Tileset → Terrain → add a set → Corner (Wang)**, add colors,
click each tile's corners, then paint with the terrain tool. (The older `Edge` /
`Corner (blob)` peering modes are still there for single-terrain autotiling.)

## Orientations

Isometric, staggered, and hexagonal maps are authored **natively in the editor** —
no external tool needed. Create one with **Entity → New Tilemap**, pick the
orientation (and, for hex/staggered, the stagger axis/index and hex side length),
then paint. The viewport draws the matching diamond or hex grid, and the map's
orientation is switchable any time from the **Tilemap Layer** inspector. The three
scenes above were built exactly this way; open any of them to see the shaped grid
and paint on it.

## One runtime model

The point of the demo is that both paths **converge on the same runtime tileset
model**. Whether tiles come from a Tiled `.tmj` or an `.estileset`, the engine
resolves them to one table of `{ firstId, texture, columns }` slots plus the same
live collision and animation data. So:

- The `.tmj` gives you the whole Tiled ecosystem (author in Tiled, drop the file in).
- The `.estileset` makes the tileset the **single source of truth**: edit a tile's
  collision or animation once and every map that references it updates — no
  re-baking, no per-scene copies.

## Assets

| File | Role |
| --- | --- |
| `assets/textures/tileset.png` | Kenney Pixel Platformer terrain atlas (360×162, 18px tiles, 20×9). |
| `assets/textures/props.png` | A few of its tiles repacked as a second tileset (gem, heart, coin box, key, foliage). |
| `assets/maps/level.tmj` | The Tiled map (both tilesets embedded, CSV layer data). |
| `assets/tilesets/terrain.estileset` | The engine-native tileset: atlas grid + per-tile collision + water animation. |
| `assets/tilesets/iso-tiles.png` + `iso.estileset` | Six 64×32 **isometric** diamond terrain tiles (grass/water/sand/stone/dirt/forest). |
| `assets/tilesets/hex-tiles.png` + `hex.estileset` | Six 64×64 pointy-top **hexagon** terrain tiles (grass/water/sand/forest/mountain/snow). |
| `assets/tilesets/wang-tiles.png` + `wang.estileset` | A 45-tile **corner-Wang** terrain set — every grass/sand/water corner combination, blended by a smooth marching-squares boundary. |

The platformer art is **Kenney [Pixel Platformer](https://kenney.nl/assets/pixel-platformer)
(CC0)** — reuse it freely, including commercially. See
[../ASSETS.md](../ASSETS.md). The isometric and hexagonal tiles are simple
procedurally-generated terrain shapes, CC0 as well.

## Running

Open the folder in the Estella editor and press **Play**, or point the example
launcher at it. `src/main.ts` is intentionally empty — add systems there to make
the map interactive (for example, spawn a character that walks the collidable
ground and swims through the animated water).
