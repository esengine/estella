# REARCH — Prefabs (model-authoritative instances over the engine's prefab module)

Status: **design / proposed**. The payoff layer of the model-authoritative editor
(`REARCH_EDITOR_MODEL.md`) sitting on the asset pipeline (`REARCH_ASSETS.md`).
**Key fact: the engine already implements the entire prefab DATA system** — this
doc wires the editor onto it and closes the one scene-format gap. Not a rewrite.

## 1. What the engine already provides (the big reuse)

`sdk/src/prefab/` is a complete, tested prefab data layer:

- **`PrefabData`** (`.esprefab`): `{ version, name, rootEntityId, entities:
  PrefabEntityData[], basePrefab?, overrides? }`. Entities use a stable string
  `prefabEntityId`, carry `components/parent/children/visible/metadata?` and an
  optional `nestedPrefab`. `basePrefab` gives **variants** (inherit + override).
- **`flattenPrefab(prefab, overrides, ctx)` → `{ entities: ProcessedEntity[],
  rootId }`** — EXPANDS a prefab + its overrides (+ nested + variants) into flat
  entities, allocating runtime ids while preserving each `prefabEntityId`.
- **`diffAgainstSource(source, instance, opts)` → `{ overrides, untracked,
  orphanedSourceIds }`** — COLLAPSES an instance subtree back to a minimal
  `PrefabOverride[]` (float-epsilon aware, ignore-lists, etc.).
- **`PrefabOverride`** covers everything: `property`, `component_added`,
  `component_replaced`, `component_removed`, `name`, `visibility`,
  `metadata_set`, `metadata_removed`.
- Plus `migratePrefabData`, `bucketOverridesByEntity`, `validateOverrides`,
  `cloneComponentData`, `preloadNestedPrefabs`, and the runtime
  `instantiatePrefab(world, prefab, {overrides, parent, assets})` /
  `PrefabServer.instantiate(path)`.

So **expand / collapse / overrides / nesting / variants are DONE**. The architecture
below is the natural one *because the engine already speaks it.*

## 2. Problem: the editor doesn't use it, and scenes can't persist instances

- **No editor prefab workflow.** No "instantiate prefab" command, no editing a
  prefab instance, no open-`.esprefab`-as-document, no override UI. The asset
  pipeline (`REARCH_ASSETS.md` A2/A4) already indexes `.esprefab` + tracks its
  deps, but nothing instantiates one into a scene.
- **The scene format can't persist a prefab instance.** `SceneData` entities are
  `{ id, name, parent, children, components, visible? }`; `loadSceneData`
  (`sdk/src/scene.ts`) has **no prefab handling**. Prefabs can only be
  instantiated programmatically (`PrefabServer.instantiate`), never authored into
  a saved scene with overrides. So there's no `play == ship` for prefab content.

## 3. Principle: instance = a document delta in the FILE, expanded entities in the MODEL

A prefab instance is, **in the scene file, a minimal delta** — `{ prefab: @uuid,
overrides }` — and, **in the open model, the fully-expanded real entities**.
**Load expands** (the engine's `flattenPrefab`); **save collapses** (the engine's
`diffAgainstSource`). The model-authoritative spine *is* the prefab editing engine.

```
.esprefab asset (PrefabData; @uuid-addressed; A2 dep graph already tracks it)
   │  load: flattenPrefab(asset, overrides) → ProcessedEntity[] → SceneModel entities
   │        (real source ids; each tagged with its prefabEntityId + instance root)
   ▼
SceneModel (ordinary entities — Reconciler / SceneQuery / selection / commands /
            undo all operate UNCHANGED; prefab-ness is inert tag metadata)
   │  save: group instance subtree → diffAgainstSource(asset, subtree) → overrides
   ▼
scene file: { id, prefab:@uuid, parent, overrides:[…] }   — minimal, propagatable
```

**The core decision — expand-in-model, not keep-collapsed.** The alternative
(store one `{prefab,overrides}` record and expand only at read/projection time)
forces a *second* addressing scheme (instanceRoot + prefabEntityId) through
SceneQuery / Reconciler / selection / commands — a parallel system fighting the
clean single-source-id model. Expand-in-model keeps **one** entity model and
**one** addressing scheme; prefab-ness becomes metadata + a load/save transform.
This is what Unity does internally (instances are real objects + a modification
list; the file stores the delta) and is the cleanest fit for our spine.

### 3.1 A `{prefab, overrides}` delta is NOT enough — structural edits

`PrefabOverride` covers `property` / `component_*` / `name` / `visibility` /
`metadata_*` — but it has **no `entity_added` / `entity_removed`**. By design,
`diffAgainstSource` returns *structural* instance edits separately:

- a child entity **added** to the instance → `untracked: ProcessedEntity[]`
- a prefab child **deleted** in the instance → `orphanedSourceIds: PrefabEntityId[]`

(`sdk/src/prefab/diff.ts`: *"Does NOT yet emit entity_removed overrides … →
`orphanedSourceIds`"*.) So a pure `{prefab, overrides}` entry persists property/
component edits losslessly but **silently loses structural instance edits**.

The complete scene instance entry is therefore:

```
{ id, prefab: @uuid, parent,
  overrides:  PrefabOverride[],     // diffAgainstSource().overrides
  added:      SceneEntity[],        // .untracked  — entities added under the instance
  removed:    PrefabEntityId[] }    // .orphanedSourceIds — prefab children deleted here
```

On load: `flattenPrefab(asset, overrides)` → minus `removed` → plus `added`. On
save: write all three buckets from `diffAgainstSource`. This is the modern-Unity
model (added objects + removed components/objects are stored alongside the
modification list). The earlier "minimal delta" framing was incomplete — structural
fidelity requires these buckets (or, the restrictive alternative, disallow
structural edits on instances until the user "unpacks").

## 4. Target architecture (mapped to our components)

1. **Prefab asset** = `.esprefab` (`PrefabData`), already an `@uuid` asset. **Editing
   a prefab = open it as a document in the SAME editor** (it's just entities) —
   zero new authoring UI.
2. **Scene-format gap (the one engine change).** A `SceneData` entity may carry
   `{ prefab: <ref>, overrides: PrefabOverride[] }` (the instance root). `loadSceneData`
   detects it, loads the prefab asset, calls `flattenPrefab`, and spawns the
   subtree. This is a small, clean completion of the existing prefab module — and
   gives `play == ship` for prefab scenes (the runtime loads the same delta).
3. **Editor load — expand.** `ProjectStore.loadCurrentScene` (which already owns
   asset access) expands each prefab-instance entry via `flattenPrefab` into
   SceneModel entities with fresh source ids, tagging each with its
   `prefabEntityId` + the instance-root source id (in `entity.metadata`, the field
   the engine designed to survive round-trips). Then `Reconciler.adopt` as usual.
4. **Editor save — collapse.** `serializeCurrent` groups each instance subtree (by
   the instance-root tag), maps it to `ProcessedEntity[]`, and calls
   `diffAgainstSource(prefabAsset, subtree)` → overrides → writes a single
   `{ id, prefab, parent, overrides }` entry; non-prefab entities serialize normally.
5. **Instantiate command.** Drag a `.esprefab` from the Content Browser into the
   scene → `SceneCommands.instantiatePrefab(ref, parent)` → `flattenPrefab` → add
   the tagged entities to the model (ordinary `addEntity` sequence) → the
   Reconciler spawns them. Undoable — and it reuses the recursive-delete subtree
   path already built.
6. **Overrides are free.** Any ordinary edit inside an instance (setField /
   addComponent / reparent / rename / visibility) is captured at save by
   `diffAgainstSource`. No per-edit override bookkeeping.
7. **Nesting + variants are free** — `flattenPrefab`/`diffAgainstSource` already
   handle `nestedPrefab` + `basePrefab`; the A2 dep graph already records nested
   prefab refs.
8. **Propagation.** On a prefab-asset change (the asset DB watch, `REARCH_ASSETS.md`
   A2c), re-expand the open scene's instances of that prefab: re-`flattenPrefab`
   with the instance's current overrides, preserving them. Closed scenes pick up
   the new prefab on next load.

The Reconciler, SceneQuery, selection, commands, and undo need **no changes** —
they see ordinary entities. Only the load/save boundary (ProjectStore) and one
new command know prefabs exist.

## 5. How each goal is met (reuse-first)

| Goal | How |
|---|---|
| Expand / collapse / overrides | The engine's `flattenPrefab` / `diffAgainstSource` / `PrefabOverride` — reused verbatim. |
| Compact, portable scene files | Instances persist as a delta — `{ prefab:@uuid, overrides, added, removed }` (§3.1) — not the expanded subtree. |
| Edit instances naturally | Expanded entities are ordinary model entities — the whole editor works unchanged. |
| `play == ship` | Both editor + runtime expand the same delta via `flattenPrefab` (needs the §4.2 loader gap). |
| Nesting + variants | Already in the prefab module. |
| Prefab authoring UI | Open `.esprefab` as a scene document — reuses the editor. |
| Asset integration | Prefab = `@uuid` asset; A2 dep graph + A4 cook already include prefabs. |

## 6. Phased plan

- **PF1 — scene-format + `loadSceneData` prefab-instance support** (the one engine
  change; `sdk/src/scene.ts`, reusing `sdk/src/prefab/flatten`). A scene entity may
  be `{ prefab, overrides }`; load expands it. Unit-testable in node. Unblocks
  `play == ship` for prefab scenes.
- **PF2 — editor instantiate + load-expand + save-collapse** on the SceneModel:
  `SceneCommands.instantiatePrefab`, ProjectStore expand-on-load / collapse-on-save
  via `flattenPrefab` / `diffAgainstSource`, persisting all three buckets
  (`overrides` + `added` + `removed`, §3.1), instance-tag metadata. Drag-from-
  Content-Browser to instantiate. **Ship the round-trip safety test FIRST** (see §7).
- **PF3 — override UX**: highlight overridden fields in the Inspector (diff vs the
  prefab), Revert-override, Apply-instance-to-prefab (writes the asset),
  open-`.esprefab`-as-document, and propagation on asset change (A2c).

Prereq: PF2/3 need the asset DB (A2, done) to read prefab assets for
expand/diff; PF1 needs the prefab module (done).

## 7. Open decisions

- **Round-trip is the safety net (REQUIRED, do first).** Save persists via
  `diffAgainstSource`, so a diff/flatten gap = silent data loss. Before wiring
  save, land a test asserting `expand(collapse(instance)) === instance` for a
  scene of instances exercising every override type + structural `added`/`removed`
  (§3.1). The engine module is well-covered (`sdk/tests/prefab*.test.ts`, ~82),
  but the editor's collapse→file→expand round trip is new and must be pinned.
- **Structural instance edits** are handled by the three-bucket entry (§3.1) —
  decided, not open; the only sub-choice is allow-now vs. require-unpack-first.
- **Delta-in-scene (optimal) vs baked-in-scene (no engine change).** §4.2 (delta +
  `loadSceneData` expansion) is optimal — minimal files, propagation, `play==ship`
  — but touches `sdk/src/scene.ts`. A no-engine-change fallback BAKES the expanded
  subtree into the scene with `entity.metadata` prefab tags (the runtime ignores
  metadata; the editor re-expands on propagation): larger files, fully editor-side.
  **Recommend delta** — it's the right architecture and the prefab module makes the
  loader change small; the sdk touch is a legitimate engine completion.
- **source id ↔ `prefabEntityId` mapping.** The editor allocates scene source ids
  on expand and stores the origin `prefabEntityId` (+ instance-root id) in
  `entity.metadata`; `diffAgainstSource` matches by `prefabEntityId` at save.
- **Propagation timing.** Re-expand open instances eagerly on the asset DB change
  event (A2c), preserving overrides; vs. lazy on next load only. Eager is the
  better UX once A2c lands.
- **Variants in the editor** — `basePrefab` works at the data layer; surfacing
  "create variant" in the UI is a PF3+ nicety, not required for PF1/2.
