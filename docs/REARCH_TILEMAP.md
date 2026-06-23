# Tilemap — Architecture & Rearchitecture

**Status (2026-06-23):** **T0 + T1 DONE + pushed** (T1 = runtime tile collision for the
asset-driven `Tilemap{source}` path, closing the long-standing "B2-1" debt); **T2 in
progress** (Tileset editor + `.estileset`). Tilemap runtime = a C++ side concern
(`src/esengine/tilemap/TilemapSystem.cpp` chunk store + `renderer/plugins/
TilemapRenderPlugin.cpp`), driven by the SDK (`sdk/src/tilemap/*`). The editor has **no**
tilemap/tileset authoring tools yet.

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

**The Unity/Godot consensus, adapted to this engine's editor-first / model-authoritative
core** — *not* the UE-Paper2D standalone-tilemap-asset model (an earlier draft of this doc
leaned that way; on review it fights the engine's grain). Three axes, each resolved to the
optimum for *this* engine:

1. **Tileset = `.estileset` reusable asset** (universal across Unity/Godot/UE). The single
   source of truth for how a tile looks (atlas slicing) AND behaves. Richer than a
   collision boolean — per-tile collision **shapes**, animation, properties, with an
   extensible slot for terrain/autotile rules:
   ```jsonc
   {
     "version": "1", "texture": "@uuid:…",
     "tileWidth": 16, "tileHeight": 16, "columns": 8, "margin": 0, "spacing": 0,
     "tiles": {                          // sparse — only tiles carrying metadata
       "5":  { "collision": { "type": "box" }, "animation": [{ "tile": 5, "durationMs": 100 }] },
       "12": { "collision": { "type": "polygon", "points": [[0,0],[16,0],[16,8]] } }  // a slope
     }
   }
   ```
   Edited in the **Tileset editor** (an `AssetDocument` subclass — `.estileset` IS a file).
2. **Tilemap data = scene-embedded first-class `TilemapLayer` entities** (Unity component /
   Godot node), NOT a standalone asset. Why this beats the standalone-asset model here:
   (a) painting becomes ordinary **scene editing** through SceneCommands/Reconciler — the
   same model-authoritative pipeline as the rest of the editor; (b) each layer is a real
   entity (selectable / transformable / parentable / z-orderable), vs the `Tilemap{source}`
   synthetic-layer black box; (c) no redundant new format. Tiles persist via the existing
   out-of-band chunk codec; undo via a tile-region command diff (T3 decides model-field vs
   command-diff). The `Tilemap{source}` component (Tiled `.tmj` import + a *future optional*
   standalone `.estilemap` for cross-scene reuse) stays as the SECONDARY import path.
3. **Collision authority = the tileset** (Godot model). Colliders are derived at runtime
   from `(placed tiles) × (tileset collision shapes)`: boxes greedy-merged (T1), custom
   polygons emitted per-tile (later). Change the `.estileset` → every map updates. T1's
   Tiled-property collision stays for the import path; both converge on
   `generateLayerCollision`. **C++ stays render-only** — `.estileset` resolution (texture
   handle + collision shapes) happens in the SDK plugin (engine's C++-mechanics /
   SDK-assets split).

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
- **T2 — Tileset editor + `.estileset`.** SDK format (`tilesetAsset.ts`: `TilesetAsset`
  type + `parseTileset`/`serializeTileset` + version, exported via the tilemap barrel) +
  `AssetDocument<TilesetAsset>` + Tileset panel (texture grid overlay, tileW/H/margin/
  spacing controls, click/drag to toggle per-tile collision) + Content-Browser open +
  Create-Tileset-from-texture + asset-type registration. The palette + collision authority.
- **T3 — Tilemap painter (scene-embedded `TilemapLayer`).** Paint into first-class
  `TilemapLayer` entities through SceneCommands/Reconciler (model-authoritative), with a
  selected `.estileset` as the brush palette: layer list, brush/fill/erase/rect/bucket/
  eyedropper, live in the viewport (no separate preview mirror needed — it's the real
  scene). Decide tile-data home (model-field chunks vs command-diff undo). Create-Tilemap
  spawns a `TilemapLayer` entity referencing an `.estileset`.
- **T4 — Unify native-path collision + physics enablement.** Resolve the referenced
  `.estileset`'s collision shapes for scene `TilemapLayer` entities → `generateLayerCollision`
  (boxes) + per-tile polygons; make a tilemap carrying collidable tiles signal
  `sceneUsesPhysics` (closes the T1 caveat: runtime-spawned colliders are invisible to the
  content-scan gate). See [[estella-physics-audit]] / [[subsystem-observability]].
- **Later (extensible, not now):** standalone `.estilemap` asset for cross-scene reuse;
  terrain/autotile (wang/rule tiles) in `.estileset`; one-way platforms + physics layers.

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
