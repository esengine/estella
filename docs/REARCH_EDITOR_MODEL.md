# REARCH — Model-Authoritative Editor (unidirectional data flow)

Status: **P1 + P2-core implemented** (2026-06-20); P3 proposed. Authoritative
plan for inverting the editor's data flow from *dual-write* to a single source of
truth with derived projections. This is the natural completion of
`REARCH_SERIALIZATION.md` (JSON-first model) and the prerequisite for
`REARCH_EDITOR_REALM.md` (isolated play).

**P2-core done** — the engine-state singletons are now instance classes wired by
constructor injection (`SceneModelImpl`/`EditorHistoryImpl`/`SceneStoreImpl`/
`ReconcilerImpl`/`SceneCommandsImpl`/`SceneQueryImpl` + `createSelectionStore`).
A new `desktop/src/engine/EditorSession.ts` owns the whole graph as ONE instance;
`EditorControlSurface` is its façade (`EditorControlSurfaceImpl(session)`).
`EditorSession.create()` builds an isolated session (fresh model/history/.../World
projection) for a headless host, the MCP server, or a test — proven by migrating
every wasm test to a per-test session (no shared-singleton `clear()`). The app's
default-session singletons are preserved, so the UI/EngineHost are unchanged.
**Remaining P2 (gradual):** route the UI through `session`/the surface (full H2
closure) and decouple EngineHost from the default-session reconciler — these need
no new design, just mechanical migration; genuine multi-World sessions await the
engine-instancing pillar. RESUME: finish P2 UI-routing **or** start **P3**
(isolated play realm).

**P1 done** — commands mutate the `SceneModel` (by stable source id) only; a new
`desktop/src/engine/Reconciler.ts` projects model→World (the World is now a pure
derived projection); `SceneStore` is a model-change bus (the engine `editorBridge`
is retired as the editor reactivity source); `SceneQuery` reads the model;
selection is source ids self-healing on the model's `entityRemoved`; the
`schemas.json` consumer (`schema.ts`) makes unknown/user components inspectable +
editable; `setRunMode` Stop rebuilds the World from the untouched model (no
snapshot/restore); scene load clears history + selection. 64 desktop vitest pass
(+ `inspector-model.test.ts`, hierarchy/unknown lossless-undo). RESUME: **P2**
(EditorSession instance + EditorControlSurface as its façade), then **P3**
(isolated play realm).

## 1. Problem: dual-write desyncs

Today every mutation **writes the World AND the `SceneModel`** (the JSON-first
truth), kept in sync by `runtimeToSource`/`sourceToRuntime` entity-id maps. The
World is a lossy render projection; the model is the lossless truth. This is
correct in steady state but the binding goes stale on any *wholesale* World
change, and the World capture is lossy on recreate. The consequences (all
observed):

- **Play→Stop model desync.** `EngineHost.setRunMode` does
  `serializeScene(world)` then `resetWorldTo(world, snapshot)`; the new runtime
  ids are never re-`adopt`ed, so the model maps go dead → post-Stop edits resolve
  to `undefined` and silently never reach the model → lost on save.
- **Scene reload leaves stale history/model.** `ProjectStore.loadCurrentScene`
  re-`adopt`s a new model but never clears `EditorHistory`/`SceneModel`, so undo
  closures reference dead entities from the previous scene.
- **Lossy undo-recreate.** `SceneCommands` captures recreated entities from the
  registry-only World (`STRUCTURAL_SKIP = {Parent, Children}`), so delete→undo
  drops hierarchy AND unknown/project components from the World projection.
- **Unknown/project components are invisible.** The inspector enumerates the live
  engine registry; project code never runs in the editor realm, so user
  components (which the loader SKIPs into the model only) can't be inspected or
  edited. `schemas.json` was built to fix this but has no consumer.
- **Reads leak into the raw World.** `Details.tsx` reads `EngineHost.world`
  directly; the outliner derives hierarchy from World `Parent`. The truth (the
  model) is bypassed for reads.

These are **one root cause**: two sources of truth synchronized by convention.

## 2. Principle: unidirectional, model-authoritative

```
                 ┌──────────── single source of truth ────────────┐
  Command ──write│  Document Model (SceneModel)                    │── change events ─┐
  (only writer)  │  lossless JSON: entities / components (incl.    │                  │
                 │  unknown) / hierarchy / @uuid refs              │                  │
                 └─────────────────────────────────────────────────┘                  ▼
       ▲                         │ read                                     ┌────────────────────┐
       │                         ├──▶ Inspector / Outliner (read MODEL)     │  Reconciler        │
  Undo = model ops               ├──▶ Selection (MODEL source ids)          │  model → World     │
  (TransactionManager over the   │                                          │  spawn/set/despawn  │
   model; lossless by record)    └──────────────────────────────────────── │  (known comps;      │
       │                                                                    │   unknown stay model)
       └──────────────────────────────────────────────────────────────────└─────────┬──────────┘
                                                                                      ▼
                                                              World (pure projection; read only for
                                                              camera-derived geometry: pick / gizmo)
```

**Invariant: the World is a pure function of the Model.** Commands mutate the
Model only; a Reconciler projects Model→World. There is no path that writes the
World directly (except the Reconciler), so they cannot diverge.

This is the pattern mature editors converge on: UE (UObject graph is truth, the
world is constructed from it), Unity (serialized objects are truth), Figma /
VS Code (the document is truth; the scene graph / view is derived).

## 3. Target architecture (6 layers)

1. **Document Model** — `SceneModel` upgraded to the sole truth; addressed by
   **stable source id**; emits fine-grained change events. Holds unknown
   components + `@uuid:` refs + invisible entities verbatim.
2. **Commands + Transactions** — every mutation is a command that edits the
   model; `EditorHistory` records **model operations** (not World re-spawns), so
   undo restores the full model record → lossless by construction.
3. **Reconciler** — subscribes to model changes; projects to the World
   (spawn/despawn/insert/remove/set) for components the engine knows; leaves
   unknown components in the model only. Owns the source↔runtime id map; rebuilds
   it on a wholesale model load (bulk path = `resetWorldTo(world, model.data)`).
4. **Selectors / Queries** — `SceneQuery`, inspector, outliner read the **Model**.
   The Viewport reads the **World** only for camera-derived screen geometry
   (pick, gizmo, selection outline) via the engine `CameraView` — that is
   rendering, the engine's domain.
5. **EditorSession (single boundary)** — owns {model, history, selection,
   reconciler, App/World, handles} as an **instance**; the one API for UI,
   headless host, and MCP. `EditorControlSurface` becomes its façade. (Phase 2.)
6. **Isolated Play Realm** — Play runs the scene in an iframe/worker loading the
   built `scripts.mjs` + the model's scene data. The editor realm never runs
   project code; Stop destroys the realm; the editor model/World are untouched.
   `play == ship`. (Phase 3.)

## 4. How each problem dissolves (structural, not patched)

| Problem | Why it cannot happen |
|---|---|
| Play→Stop model desync | Play is isolated (P3); the editor model never participates, so there is no snapshot/restore and no stale map. Until P3, Stop just re-reconciles the World from the untouched model. |
| Scene reload stale history | A scene = a session document; replacing it clears the model + history; the reconciler rebuilds the World + binding. |
| Lossy undo-recreate | Undo replays the **model op**; the model record holds every component + the parent link → reconciler re-projects → lossless. |
| Unknown components invisible | Inspector reads the **model** (+ `schemas.json` for field shapes); unknown components live in the model and are editable, just not projected to the World. |
| `Details` reads raw World | No UI reads the World; it is only read for camera geometry. |
| `EditorControlSurface` bypassed | One `EditorSession` boundary; UI / headless / MCP all go through it. |
| Singletons assume one window | `EditorSession` is an instance → multi-scene / multi-window are natural. |

## 5. Phased migration (reuse-heavy, not a rewrite)

- **P1 — Data-flow inversion** (highest ROI; kills the data-bug class #1–#4 + the
  raw-World read leak). Pure editor-side TS, unit-testable, no engine change.
- **P2 — Session scoping.** Collapse the engine-layer singletons into one
  `EditorSession` instance; `EditorControlSurface` becomes its façade; the UI
  routes through it (closes H2).
- **P3 — Isolated play realm.** Build the `scripts.mjs` / `schemas.json` realm
  loader + iframe play; delete `setRunMode`'s snapshot/restore entirely.
- **Cross-cutting (fold in anytime):** SDK type exports (kill shadow-typing),
  jsdom interaction tests, error boundaries + failure toasts, command-registry
  extension points + persisted keymap, multi-entity transform.

## 6. P1 — detailed implementation checklist

Goal: commands mutate the model (by source id); a Reconciler projects to the
World; reads come from the model; undo records model ops.

**New — `src/engine/Reconciler.ts`**
- Subscribes to model change events; projects each to the World:
  - entity added → `world.spawn()` + `SceneModel.bindRuntime(sourceId, runtime)`;
    insert each component the registry knows (`getComponent(type)`); skip unknown.
  - entity removed → `world.despawn(runtime)`.
  - field/component set → `world.set/insert` for known types; no-op for unknown.
  - component removed → `world.remove`.
  - parent changed → World `Parent` insert/remove.
- Bulk path (load): `resetWorldTo(world, model.current)` → returns entityMap →
  `SceneModel.adopt(model, entityMap)` (reuses the engine loader; no per-entity
  spawn loop). Used by boot + project load + (until P3) play-stop.
- Owns nothing the model already owns — it drives `SceneModel.bindRuntime`.

**Change — `SceneModel`** (truth + event source)
- Add a change emitter (or reuse `SceneStore` as the bus): emit
  `entityAdded(sourceId)`, `entityRemoved(sourceId)`, `componentChanged(sourceId,
  type)`, `parentChanged(sourceId)`. Mutations key off **source id** (overloads
  that take `runtime` resolve via `sourceFor` and stay for the gizmo path).
- `setField`/`setComponent`/`removeComponent`/`addEntity`/`removeEntityBySource`/
  `restoreEntity`/`setParent` already exist — they become the *only* writers and
  emit events. `removeEntityBySource` must also scrub the child id from its
  parent's `children[]`.

**Change — `SceneCommands`** (single model write, no dual-write)
- `setField` → `SceneModel.setField` (model emits → reconciler projects). Delete
  the `applyFieldWrite` World write.
- `addEntity` → `SceneModel.addEntity` (allocate source id, no runtime) → emit →
  reconciler spawns + binds. Return the **source id**.
- `deleteEntity` → `SceneModel.removeEntityBySource`; undo = `restoreEntity(full
  record)` → reconciler respawns. Delete `captureEntity`/`recreateEntity` (the
  lossy World capture).
- `addComponent`/`removeComponent`/`setParent`/`duplicateEntity` → model ops only.
- `beginGesture`/`endGesture` unchanged (still coalesce into one undo step).

**Change — `EditorHistory`** records model ops. `forward`/`reverse` mutate the
model; the reconciler follows via events. (TransactionManager unchanged.)

**Change — `SceneQuery`** reads the Model
- `readSceneTree` from `SceneModel.current.entities` (hierarchy from
  `parent`/`children`), not World `Parent`.
- `readInspector`/`readEntity`/`getFieldValue` from the model entity's
  `components` (incl. unknown) + field shapes from the registry (builtin) or
  `schemas.json` (user). The Viewport's pick/gizmo/`worldToClient` keep reading
  the World via `CameraView`.

**New — `schemas.json` consumer** in `schema.ts`
- Load `.esengine/cache/schemas.json` (via the fs IPC bridge) on project open;
  merge as a field-shape source for component names absent from the engine
  registry. `inspectableComponents` enumerates the **model entity's** component
  types, resolving each shape from registry-or-schemas.json. (Closes rearch E1.)

**Change — Selection** references **source ids** (stable, survive recreate);
self-heal on `entityRemoved`. The Viewport resolves source→runtime
(`SceneModel.runtimeFor`) for the gizmo/outline.

**Change — `ProjectStore.loadCurrentScene` / `EngineHost` boot** call
`EditorHistory.clear()` + `SceneModel.clear()` before adopting, and use the
Reconciler's bulk path.

**Delete (eventually):** the engine `editorBridge` as the editor's reactivity
source — the editor now reacts to **model** events, not engine-pushed mutations
(the World is derived). Keep the bridge only if other consumers need it.

**Tests (P1 acceptance):**
- Round-trip stability: load → batch of edits (field/color/angle, add/remove
  component, reparent, add/delete/duplicate) → `serialize()` → reload → re-serialize
  → assert identical.
- Lossless undo: delete a parented entity carrying an unknown component → undo →
  assert the World projection AND the model both have it back, with the parent
  link restored.
- Scene reload: open scene B after A, then undo → assert no-op on B's world (no
  dead-handle mutation).
- Unknown-component inspector: load a scene with an unknown component + its
  `schemas.json` → inspector lists + edits its fields → model round-trips.
- Extend `engine-model-sync.test.ts` / `scene-model.test.ts`.

## 7. Open decisions

- **Selection id space.** Recommend **source ids** (stable). Requires migrating
  `selectionStore` + the Viewport's resolve. Alternative (runtime ids) keeps the
  current code but re-introduces self-heal-on-respawn complexity.
- **Reconciler granularity.** Per-change incremental for edits; bulk
  (`resetWorldTo`) for load. A "dirty set + flush per frame" batcher is a later
  optimization, not needed for P1.
- **SceneStore vs a new emitter.** Reuse `SceneStore` as the model-change bus
  (it already drives panel reactivity) rather than adding a parallel emitter.
