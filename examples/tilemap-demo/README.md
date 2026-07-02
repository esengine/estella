# Tilemap Demo

Estella's tilemap system, shown two ways — **a Tiled `.tmj` import** and **an
engine-native `.estileset`** — over the same Kenney Pixel Platformer art. Both are
drawn by the built-in tilemap plugin with **no gameplay code**; the level lives
entirely in the scene/assets.

| Scene | Authoring path | What it shows |
| --- | --- | --- |
| `assets/scenes/tiled-map.esscene` *(default)* | `Tilemap { source: "…/level.tmj" }` | Imports a real [Tiled](https://www.mapeditor.org/) map: **two embedded tilesets** (`terrain` + `props`, global GIDs), a **parallax** background of clouds, **animated** water, and **per-tile collision** — the map is auto-loaded when the scene opens. |
| `assets/scenes/native-map.esscene` | `TilemapLayer` → `.estileset` | References the engine's first-class tileset asset. Collision and the water animation are **derived live at runtime** from the tileset — nothing is baked into the scene but the tile chunks. |

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

Art is **Kenney [Pixel Platformer](https://kenney.nl/assets/pixel-platformer)
(CC0)** — reuse it freely, including commercially. See
[../ASSETS.md](../ASSETS.md).

## Running

Open the folder in the Estella editor and press **Play**, or point the example
launcher at it. `src/main.ts` is intentionally empty — add systems there to make
the map interactive (for example, spawn a character that walks the collidable
ground and swims through the animated water).
