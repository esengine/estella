# REARCH — Unified Asset Pipeline (AssetDatabase)

Status: **design / proposed**. Authoritative plan for the engine's second spine —
**content/assets** — complementing the document/scene spine built in
`REARCH_EDITOR_MODEL.md` (model-authoritative editor) and
`REARCH_SERIALIZATION.md` (JSON-first scenes). It is the foundation the Content
Browser, prefabs (`REARCH_PREFABS.md`, future), materials/fonts/audio in the
editor, hot-reload, and the ship/cook path all sit on.

## 1. Problem: a strong runtime asset system the editor doesn't use

The **runtime** already has a capable asset system — it is not the gap:

- `sdk/src/asset/Assets.ts` loads every type (`loadTexture`/`loadMaterial`/
  `loadFont`/`loadAudio`/`loadSpine`/`loadAnimClip`/`loadTilemap`/`loadTimeline`/
  `loadPrefab`), with ref-counted caches, hot-reload (`invalidate` / `onInvalidate`),
  a pluggable `setAssetRefResolver` / `setAssetRegistry`, and scene-level
  `preloadSceneAssets` + `resolveSceneAssetPaths`.
- `sdk/src/asset/AssetRegistry.ts` resolves `@uuid:` → path (`resolveRef` /
  `uuidToPath`); `sdk/src/runtimeLoader.ts` abstracts fetching per platform.
- `tools/asset-meta.js` generates per-asset `.meta` sidecars
  (`{uuid, version, type, importer}`) for ~all types and can `--emit-manifest`.
- `.esprefab` files + `Assets.loadPrefab` already exist (e.g.
  `examples/space-shooter/assets/prefabs/*`).

The gap is **the editor and the project layer**:

- **The editor re-implements a texture-only subset.** `ProjectStore.resolveTextures`
  scans `.meta`, loads **only textures** via `estella://`, and writes its own
  `uuidToHandle` map — bypassing the engine `Assets`/`AssetRegistry`. Its own
  comment: *"material/font refs aren't served yet."* So in the viewport,
  materials/fonts/audio/spine/tilemap refs resolve to handle `0` (blank).
- **Three duplicate resolution paths.** `ProjectStore.resolveTextures`,
  `SceneLoader.loadTextures`, and the P1 `Reconciler.setAssetResolver` each
  collect uuids → load → map to handles independently. They drift.
- **No project-wide AssetDatabase.** `.meta` generation is a one-shot CLI;
  `AssetRegistry` is a runtime manifest. Nothing in the editor *lives*: scans the
  project, watches for changes, tracks dependencies, and serves one index to the
  Content Browser + the registry + the cook.
- **Content Browser is read-only.** `ContentBrowser.tsx` lists/searches/previews
  but Import/Add are disabled and tiles are `draggable={false}` — no import, no
  drag-assign to inspector fields.
- **No cook/ship step.** `asset-meta.js --emit-manifest` exists, but
  `build-tools/cli.js` does not dedupe / transcode / bundle assets per target
  (web / wechat / native).
- **Asset-field knowledge is split** across `AssetFieldRegistry` (builtins),
  `component.generated.ts`, and `extractSchemas` (user components).

**One root cause:** there is no single project-level **AssetDatabase** that the
editor, the runtime loader, and the cook all read — so the editor improvised a
texture-only slice instead of feeding the engine's existing loader.

## 2. Principle: one AssetDatabase, the content source of truth

Mirror the model-authoritative principle on the **content axis**: a single
**AssetDatabase** owns *what assets exist* (guid / type / importer / dependencies);
the editor, the engine `Assets` loader, and the cook are all **derived consumers**
of it. The editor stops resolving assets itself — it builds an `AssetRegistry`
from the DB, hands it to the engine `Assets` (`setAssetRegistry`), and reuses
`preloadSceneAssets` / `resolveSceneAssetPaths`. `@uuid:` stays the portable ref
in the lossless model; the DB is what turns a `@uuid:` into a live handle, for
**every** type, in editor and runtime alike.

```
                   ┌────────── AssetDatabase (main process, single index) ─────────┐
  Importers ──write│  scan project → .meta {guid, type, importer, deps}            │── change events ─┐
  (texture/audio/  │  dependency graph guid→[guid]; cooked/preview cache by guid    │                  │
   font/spine/...) │  artifact: .esengine/cache/assets.json (like schemas.json)     │                  ▼
                   └────────────────────────────────────────────────────────────────┘        ┌──────────────────┐
        │ serve (guid|path)                  │ registry                    │ cook   │          │  hot-reload      │
        ▼                                     ▼                             ▼        │          │  Assets.invalidate│
  estella:// AssetServer            engine Assets.setAssetRegistry    build-tools →  │          └──────────────────┘
  (editor preview + runtime)        + preloadSceneAssets +            bundles +
                                     resolveSceneAssetPaths           assets.manifest
                                            │
                                            ▼
                              the ONE resolution path: editor + runtime + cook
                              all turn @uuid: → handle through engine Assets
```

This is the pattern mature engines converge on: Unity's AssetDatabase + import
pipeline + addressables, UE's Asset Registry + Cooker. The **runtime** half
already exists here; this rearch builds the **project/editor** half and unifies
the two.

## 3. Target architecture (6 layers)

1. **AssetDatabase** (main process, alongside `extractSchemas`/`buildScripts`) —
   scans the project, reads/writes `.meta` (the git-friendly per-asset truth),
   builds the guid↔path index + dependency graph, watches the fs, and emits
   `.esengine/cache/assets.json` (the fast index artifact). One IPC surface
   (`project:assets*`) to the renderer.
2. **Importers** — per-type, producing import settings + (where needed) a cooked
   or preview artifact keyed by guid. Reuse `tools/asset-meta.js`'s extension→type
   map and default importer settings as the seed.
3. **AssetServer** — generalize the `estella://` handler (already serves project
   files by path) to also serve **by guid** (via the DB index) and to serve the
   manifest. One transport for editor preview AND runtime fetch.
4. **Editor↔engine unification** — on project open the editor builds an
   `AssetRegistry` from the DB and calls `Assets.setAssetRegistry`; scene load
   uses `Assets.preloadSceneAssets` + `resolveSceneAssetPaths`; the P1
   `Reconciler` asset resolver delegates to the registry/`Assets` for **all**
   types. The three duplicate paths collapse to one. Hot-reload: DB fs-watch →
   `Assets.invalidate(guid)` → Reconciler re-projects.
5. **Content workflow** — Content Browser **import** (copy file in + write `.meta`
   via the DB), **drag-assign** (drag a guid onto an inspector asset field →
   `SceneCommands.setField('@uuid:'+guid)`; model-authoritative, undoable), and
   **inspector asset-field controls** per type, resolved from a single asset-field
   source. The asset ref edit flows through the same model→Reconciler→Assets path.
6. **Cook / ship** — `build-tools` walks the DB dependency graph from the entry
   scene(s), transcodes/compresses/dedupes per target, emits bundles +
   `assets.manifest`. The isolated play realm (`REARCH_EDITOR_MODEL` P3) loads the
   **same** manifest → `play == ship` for assets too.

## 4. How each problem dissolves (structural, not patched)

| Problem | Why it goes away |
|---|---|
| Editor resolves textures only | The editor feeds the DB's registry to engine `Assets` and reuses `preloadSceneAssets`; every type resolves the way the runtime already loads it. |
| 3 duplicate resolution paths | One path: `@uuid:` → DB registry → `Assets` handle. `ProjectStore.resolveTextures` + `SceneLoader.loadTextures` are deleted; the Reconciler resolver delegates to `Assets`. |
| No project-wide asset index | The AssetDatabase is the live index (scan + watch + deps), the single source the Content Browser, registry, and cook read. |
| Content Browser read-only | Import writes file + `.meta` through the DB; drag-assign emits a model `setField` of the guid. |
| No ship/cook | The cook walks the DB dep graph → per-target bundles + manifest; the play realm loads the same manifest. |
| Asset-field knowledge split | One asset-field source (folded into the DB/schema layer) drives builtin + user components alike. |
| Non-texture assets uneditable in inspector | They resolve now (layer 4) and get per-type controls (layer 5). |

## 5. Phased migration (reuse-heavy, not a rewrite)

- **A1 — Unify the editor onto the engine `Assets`; collapse the 3 paths**
  (highest ROI). The editor builds an `AssetRegistry` from `.meta` and uses
  `Assets.setAssetRegistry` + `preloadSceneAssets` + `resolveSceneAssetPaths`;
  the Reconciler resolver delegates to it. Outcome: **every** asset type resolves
  and previews in the viewport; pure wiring over existing engine code.
- **A2 — AssetDatabase service.** Live scan + fs-watch + dependency graph +
  `.esengine/cache/assets.json` artifact + `project:assets*` IPC; it becomes the
  registry source (replacing the ad-hoc `.meta` scan) and the Content Browser's
  data source. Hot-reload wired through `Assets.invalidate`.
- **A3 — Content workflow.** Content Browser import + drag-assign; inspector
  asset-field controls for all types; a single asset-field source.
- **A4 — Cook / bundle.** Per-target transcode/dedupe/bundle from the dep graph +
  `assets.manifest`, integrated into the build CLI; closes `play == ship` with the
  play realm.
- **A5 — Prefabs** (own doc `REARCH_PREFABS.md`): the `.esprefab` format +
  `Assets.loadPrefab` exist; the editor authoring — prefab **instance + overrides**
  on the model-authoritative `SceneModel` (an override *is* a document delta) — is
  the payoff layer this pipeline unlocks.

## 6. A1 — detailed implementation checklist

Goal: one resolution path; all asset types resolve in the editor viewport;
`@uuid:` stays lossless in the model.

**Editor registry from `.meta`**
- On project open, build an `AssetRegistry` from the project's `.meta` files
  (reuse `tools/asset-meta.js`'s scan, or `AssetRegistry` + a manifest emitted by
  it) and call `EngineHost.getResource(Assets).setAssetRegistry(registry)`.
- Set the `estella://`-based fetch path on `Assets` (the runtime loader) so it
  fetches project files through the protocol (it already serves them).

**`ProjectStore.loadCurrentScene`** (replace texture-only resolution)
- Replace `resolveTextures` with `Assets.preloadSceneAssets(raw)` (async, all
  types) → `resolveSceneAssetPaths` to produce the resolved scene for
  `resetWorldTo`. Keep the **raw** `@uuid:` scene as the model (lossless, P1).
- Delete `mapAssetRefs`/`collectUuids`/`uuidToHandle` from ProjectStore.

**`Reconciler` resolver** (P1 `setAssetResolver`)
- Delegate `@uuid:` → handle to the registry/`Assets` for **all** types (not the
  texture-only map). Keep it a **sync** lookup of already-preloaded handles (see
  Open decisions: async). For incremental recreate (duplicate/undo) the refs were
  preloaded at scene load, so the lookup hits.

**`SceneLoader.loadInto`** — route through `Assets` + the registry (delete its
private `loadTextures`); editor + runtime now share one loader.

**Hot-reload** — DB/file change → `Assets.invalidate(guid)` → Reconciler
re-projects the affected components.

**Tests**
- Load a scene referencing a material/font/spine asset → handles are non-zero →
  viewport renders (not blank). Round-trip keeps `@uuid:` in the model.
- Duplicate/undo an entity with an asset ref → the recreated World entity keeps
  the resolved asset (no regression vs the P1 texture path).
- One-path assertion: ProjectStore no longer holds a uuid→handle map.

## 7. Open decisions

- **Async loads vs the synchronous Reconciler.** Asset loads are async; the
  World projection is sync. Pattern: **preload at the boundary** (scene load,
  drag-assign) so projection-time lookups are sync hits. A NEW ref assigned via
  the inspector must `await Assets.load*` before/within `setField` so the handle
  is ready when the Reconciler projects. (Alternative: project a placeholder
  handle, patch on resolve — more complex; defer.)
- **`.meta` (per-asset, git-friendly) vs `assets.json` (fast index).** Keep
  `.meta` as the authored truth; the DB derives `assets.json` as a cache (rebuilt
  on scan), the same artifact pattern as `schemas.json`/`scripts.mjs`.
- **guid scheme** stays UUID v4 (already established; do not change).
- **DB location** — main process (fs + watch), with an IPC index to the renderer,
  consistent with `extractSchemas`/`buildScripts`.
- **Where importers run** — pure-node in main (like `extractSchemas`), so cook is
  headless-capable.
