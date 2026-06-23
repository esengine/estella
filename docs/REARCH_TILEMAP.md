# Tilemap — Architecture & Rearchitecture

**Status (2026-06-23):** plan drafted; **T1 in progress** (runtime tile collision for the
asset-driven `Tilemap{source}` path — closes the long-standing "B2-1" debt item). Tilemap
runtime = a C++ side concern (`src/esengine/tilemap/TilemapSystem.cpp` chunk store +
`renderer/plugins/TilemapRenderPlugin.cpp`), driven by the SDK
(`sdk/src/tilemap/*`). The editor has **no** tilemap/tileset authoring tools yet.

## Verdict

The **runtime is solid** — a real C++ chunked/infinite tilemap with animations, parallax,
orthogonal/isometric/staggered grids, and out-of-band chunk (de)serialization into the
scene file. Two gaps keep it below a shippable 2D-tilemap workflow:

1. **Runtime tilemaps have ZERO physics collision.** `generateTileCollision` (greedy-merge
   collidable tiles → static `BoxCollider` entities) exists but is wired ONLY into the
   non-runtime `loadTiledMap` (tests). The production `Tilemap{source}` →
   `TilemapAssetLoader` → `TilemapSyncSystem` path never generates colliders, and the
   loader even drops `collisionTileIds`/`orientation`/`tileAnimations`/`tileProperties` at
   the cache boundary (`TilemapAssetLoader` builds a partial `LoadedTilemapSource`).
2. **No editor authoring.** Tiles can only come from an external Tiled `.tmj`/`.tmx`. There
   is no in-editor tileset/tilemap editor, though the design mockups (`ue5-tilemap.html`,
   `ue5-tileset.html`) call for them.

## Already modern — do not churn

- C++ chunked + infinite layers, per-tile animation, parallax, grid orientations.
- Out-of-band chunk codec: `TilemapLayer` chunks serialize into the `.esscene` via a
  registered scene-component codec (`tilemapPlugin.build` → `registerSceneComponentCodec`)
  — heavy tile blobs ride alongside the entity losslessly.
- The asset path: `.tmj`/`.tmx` → `parseTmjJson` → `registerTilemapSource` cache →
  `TilemapSyncSystem` builds synthetic C++ layers (no ECS-entity-per-tile bloat).
- The collision algorithm: `mergeCollisionTiles` (greedy maximal-rectangle merge) →
  one static `BoxCollider` body per merged rect (coalesced, Box2D-friendly).

## Authoring model decision (the keystone)

**Native asset model, UE5/Paper2D-aligned** (chosen over scene-embedded `TilemapLayer`
painting — that complicates undo via the out-of-band chunk codec, isn't reusable across
scenes, and doesn't match the asset-editor mockups):

- **`.estileset`** — the tileset palette asset = `{ texture: "@uuid:…", tileWidth,
  tileHeight, columns, margin, spacing, tiles: { [tileId]: { collision?, properties?,
  animation? } } }`. The reusable palette AND the single source of truth for which tiles
  collide. Edited in the **Tileset editor** (an `AssetDocument` subclass).
- **`.estilemap`** — the tilemap asset = `{ tileWidth, tileHeight, orientation, tileset:
  "@uuid:…", layers: [{ name, width, height, infinite, tiles | chunks, opacity, tint,
  parallax, visible }] }`. Edited in the **Tilemap editor** (paint/fill/erase per layer).
  Runtime loads it via a NEW native parser in `TilemapAssetLoader` (alongside `.tmj`),
  referenced from a scene by the existing `Tilemap{source}` component.
- Tiled `.tmj`/`.tmx` import stays for interop (one-way: import → `.estilemap`).
- **Collision** is derived at runtime from `(layer tiles) × (tileset collision flags)`,
  greedy-merged. Both the Tiled and native paths converge on the same generator.

## Phases

- **T0 — this doc.**
- **T1 — runtime collision for `Tilemap{source}` (closes B2-1).** Carry the dropped
  metadata (`collisionTileIds` + `orientation`/`tileAnimations`/`tileProperties`) into the
  `LoadedTilemapSource` cache; generate + lifecycle-manage tile colliders in
  `TilemapSyncSystem`, gated `playModeOnly` (colliders are runtime artifacts — never in the
  edit world, never serialized; despawned on stop / tilemap removal). Extract a generic
  `generateLayerCollision(world, tiles, w, h, tileW, tileH, ids, originX, originY)` from the
  Tiled-typed `generateTileCollision` (DRY). SDK-only, no wasm rebuild. Verify in vitest
  (collider entities spawn at correct world rects + halfExtents; despawn on stop).
  *Caveat:* tile colliders need the physics module loaded — `sceneUsesPhysics` content-scan
  can't see runtime-spawned colliders, so a collision tilemap needs `features.physics` (or
  another physics body in the scene). Folded into T4's tileset-collision flow.
- **T2 — Tileset editor + `.estileset`.** `AssetDocument<TilesetAsset>` + Tileset panel
  (texture grid, click-to-toggle per-tile collision / properties) + Content-Browser open +
  asset-type registration. The palette + collision authority.
- **T3 — Tilemap editor + `.estilemap`.** `AssetDocument<TilemapAsset>` + Tilemap panel
  (layer list, brush/fill/erase/rect/bucket, tileset palette picker) + live viewport
  preview (a `TilemapPreview` mirroring edits into a synthetic C++ layer) + a native
  `.estilemap` parser in `TilemapAssetLoader`.
- **T4 — Unify native-path collision.** Generate colliders for `.estilemap` /
  `TilemapLayer` tilemaps from the referenced `.estileset` collision flags; resolve the
  physics-enablement dependency (a tilemap carrying collidable tiles signals
  `sceneUsesPhysics`).

## Key files

- SDK runtime: `sdk/src/tilemap/{tilemapPlugin,tiledLoader,collisionMerge,tilesetCache,
  tilemapAPI,components}.ts`; loader `sdk/src/asset/loaders/TilemapAssetLoader.ts`.
- C++: `src/esengine/tilemap/TilemapSystem.{hpp,cpp}`,
  `src/esengine/renderer/plugins/TilemapRenderPlugin.cpp`,
  `src/esengine/ecs/components/TilemapLayer.hpp`, `bindings/TilemapBindings.cpp`.
- Editor pattern to copy (the Sequencer asset-document recipe):
  `desktop/src/document/AssetDocument.ts`, `desktop/src/timeline/{TimelineDocument,
  TimelineCommands,openClip}.ts`, `desktop/src/panels/Sequencer.tsx`,
  `desktop/src/engine/TimelinePreview.ts`, `desktop/src/layout/DockLayout.tsx`,
  `desktop/src/project/assetMeta.ts`, `desktop/src/components/icons.tsx`.
