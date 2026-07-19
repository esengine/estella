// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Name, getComponent, resetWorldTo, TilemapLiveSync } from 'esengine';
import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';
import { EngineHost } from './EngineHost';
import { PerfMonitor } from './PerfMonitor';
import { SceneModel, SceneModelImpl, type ModelEvent } from './SceneModel';
import { assetFieldType, spineSlotType, componentByName, componentDefaults, componentEntityFields, isRenderComponent, componentEnable, readonlyFieldsFor, type AnyComp, type WorldT } from './schema';
import { EntityRefIndex } from './EntityRefIndex';

/**
 * Projects the model into the World.
 *
 * The invariant the whole model rests on: **the World is a pure
 * function of the Model.** Commands mutate the model only; the model emits a
 * change event; this reconciler is the SINGLE place that writes the World in
 * response. There is no other path from a command to the World, so the two
 * cannot diverge.
 *
 * It owns the source↔runtime entity binding (via this.model.bindRuntime/
 * unbindRuntime) since it is what spawns and despawns. Components the engine
 * doesn't know stay in the model only — the World is a lossy render projection,
 * so unknown components / schema-extra fields / `@uuid:` refs never reach it.
 */

const UUID_PREFIX = '@uuid:';

// Asset slots whose RUNTIME value is a project path — a loader fetches the file
// (tilemap `.tmj`, anim clips, timelines, FSM/BT graphs). Everything else
// (texture/material/font/audio/tileset) is a GL/native handle. Keeping these as
// paths is why a Tiled map's `source` must NOT be run through the handle resolver
// (there is no GL handle for a .tmj → it would degrade to 0 = "no source").
const PATH_VALUED_ASSET_TYPES: ReadonlySet<string> = new Set([
  'tilemap', 'anim-clip', 'timeline', 'statemachine', 'behaviortree',
]);
/** Structural/identity components projected explicitly (name, parent), not as data. */
const STRUCTURAL = new Set(['Name', 'Parent', 'Children']);

/**
 * The World can only hold components the engine registry knows. Strip the rest
 * (project/user components like `SpawnMarker`) BEFORE the bulk `resetWorldTo` —
 * they live in the model (the raw scene) and the incremental path already skips
 * them. Keeps the World a clean known-only projection AND stops the SDK scene
 * loader from warning "Unknown component type" on every editor load. Entities are
 * preserved (only their unknown components are dropped) so the source↔runtime map
 * stays complete.
 */
function worldProjection(data: SceneData): SceneData {
  return {
    ...data,
    entities: (data.entities ?? []).map((e) => {
      const hidden = !!(e as { hidden?: boolean }).hidden;
      return {
        ...e,
        components: (e.components ?? [])
          .filter((c) => !!getComponent(c.type))
          .map((c) => (hidden ? foldHidden(c) : c)),
      };
    }),
  };
}

type SceneComp = SceneData['entities'][number]['components'][number];

/**
 * Fold editor-hidden into a render component for the World projection: force its
 * enable flag off, WITHOUT mutating the model (a fresh component object), so the
 * entity disappears from the viewport while its authored `enabled` (gameplay)
 * stays intact. Non-render components pass through untouched.
 */
function foldHidden(c: SceneComp): SceneComp {
  if (!isRenderComponent(c.type)) return c;
  const en = componentEnable(c.type, c.data as Record<string, unknown>);
  if (!en) return c;
  return { ...c, data: { ...c.data, [en.key]: false } };
}

/** Asset ref (`@uuid:<id>` or a project-relative path) → live handle, 0 if unloaded. */
type AssetResolver = (ref: string) => number;
const UNRESOLVED: AssetResolver = () => 0;

/** Asset ref (`@uuid:<id>`) → project-relative path, null when unknown. */
type RefPathResolver = (ref: string) => string | null;
const UNRESOLVED_PATH: RefPathResolver = () => null;

/** A projected asset ref that is NOT live yet (cold handle / data cache miss).
 *  The installed listener owns making it live (async load, then re-project). */
type AssetTouchListener = (ref: string, fieldType: string) => void;

export class ReconcilerImpl {
  private unsubscribe: (() => void) | null = null;
  private resolveAsset: AssetResolver = UNRESOLVED;
  private resolveRefPath: RefPathResolver = UNRESOLVED_PATH;
  private touchAsset: AssetTouchListener | null = null;
  /** referenced source id → the components pointing at it, so a spawn re-projects
   *  its referrers in O(referrers) instead of scanning the whole model. */
  private readonly refIndex = new EntityRefIndex();

  constructor(private readonly model: SceneModelImpl) {}

  /** Begin projecting model changes to the World. Idempotent. */
  attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.model.subscribe((ev) => PerfMonitor.measure('reconcile', () => this.onEvent(ev)));
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Install the asset-ref → GL-handle resolver (`@uuid:` and plain paths — the
   * same forms the scene loader accepts). ProjectStore sets this after loading a
   * scene's assets, so entities re-projected incrementally (duplicate, undo,
   * visibility toggle) re-resolve their refs the same way load does. Defaults
   * to "unresolved" (blank to 0) — fine for tests and ref-free scenes.
   */
  setAssetResolver(fn: AssetResolver | null): void {
    this.resolveAsset = fn ?? UNRESOLVED;
  }

  /**
   * Install the `@uuid:` → project-path resolver for PATH-VALUED asset slots
   * (spine skeleton/atlas). Those fields stay strings in the World — the spine
   * loaders fetch the pair themselves — so their refs resolve to a path, never
   * a handle. Installed alongside {@link setAssetResolver} by ProjectStore.
   */
  setRefPathResolver(fn: RefPathResolver | null): void {
    this.resolveRefPath = fn ?? UNRESOLVED_PATH;
  }

  /**
   * Install the cold-asset listener. The resolver contract above is synchronous
   * (a projection can't await a fetch), so an edited ref whose asset was never
   * loaded resolves to a dead value — historically it stayed dead forever, in
   * silence (the white-box family: set a texture via the surface or the picker
   * popover and the handle is 0 until the project is reopened). The listener is
   * the async half: ProjectStore loads the asset through the engine's own
   * loaders and re-projects the referencing components when it lands.
   */
  setAssetTouchListener(fn: AssetTouchListener | null): void {
    this.touchAsset = fn;
  }

  /**
   * Re-project every spawned component holding a string field that `matches`
   * (asset refs live in the model as strings — `@uuid:` or project paths).
   * The async half of the touch listener calls this when a load lands, so the
   * exact components that referenced the cold asset re-resolve to live values.
   */
  reprojectRefs(matches: (ref: string) => boolean): void {
    for (const entity of this.model.allSourceEntities()) {
      if (this.model.runtimeFor(entity.id) == null) continue;
      for (const comp of entity.components) {
        const data = comp.data as Record<string, unknown>;
        const hit = Object.values(data).some((v) => typeof v === 'string' && v !== '' && matches(v));
        if (hit) this.projectComponent(entity.id, comp.type);
      }
    }
  }

  /**
   * Bulk path (boot / project load / play-stop): build the World from a resolved
   * scene and adopt the raw scene as the model. `resetWorldTo` returns source-id
   * → runtime; this.model.adopt records the map and announces a `reset`. This
   * reconciler ignores its own `reset` (the World is already built here).
   */
  adopt(rawData: SceneData, resolvedData: SceneData): void {
    const world = EngineHost.mutableWorld();
    if (!world) return;
    // The SDK scene resolver leaves the compound spine pair alone (it loads
    // through the SpineManager, not a typed handle loader) — resolveSceneRefs
    // turns those `@uuid:` refs into project paths for the World here.
    const map = resetWorldTo(world, worldProjection(this.resolveSceneRefs(resolvedData)) as never) as Map<number, EntityId>;
    this.model.adopt(rawData, map);
  }

  /**
   * Rebuild the entire World from the current model (play-stop): resolve the
   * model's `@uuid:` refs, reset the World to it, and rebind the source↔runtime
   * map. The model is the untouched edit scene, so this discards whatever
   * gameplay did to the World during play. No-op if no scene/world.
   */
  rebuildWorld(): void {
    const world = EngineHost.mutableWorld();
    const data = this.model.current;
    if (!world || !data) return;
    PerfMonitor.measure('world.rebuild', () => {
      const resolved = this.resolveSceneRefs(data);
      const map = resetWorldTo(world, worldProjection(resolved) as never) as Map<number, EntityId>;
      this.model.adopt(data, map);
    });
  }

  // ── Event projection ──────────────────────────────────────────────────────

  private onEvent(ev: ModelEvent): void {
    switch (ev.kind) {
      case 'reset':
        // Bulk path already built the World; only the reverse index rebuilds here.
        return this.rebuildRefIndex();
      case 'entityAdded':
        return this.spawnEntity(ev.sourceId);
      case 'entityRemoved':
        return this.despawnEntity(ev.sourceId);
      case 'componentAdded':
      case 'componentChanged':
        this.reindexComponent(ev.sourceId, ev.type);
        return this.projectComponent(ev.sourceId, ev.type);
      case 'componentRemoved':
        this.refIndex.setReferrer(ev.sourceId, ev.type, []);
        return this.removeComponent(ev.sourceId, ev.type);
      case 'parentChanged':
        return this.projectParent(ev.sourceId);
      case 'nameChanged':
        return this.projectName(ev.sourceId);
      case 'hiddenChanged':
        return this.projectHidden(ev.sourceId);
    }
  }

  private spawnEntity(sourceId: number): void {
    const world = EngineHost.mutableWorld();
    const entity = this.model.entityBySource(sourceId);
    if (!world || !entity) return;

    const rt = world.spawn();
    this.model.bindRuntime(sourceId, rt);
    if (entity.name) world.insert(rt, Name, { value: entity.name } as never);
    const hidden = this.model.isHidden(sourceId);
    for (const comp of entity.components) {
      const c = hidden ? foldHidden(comp) : comp;
      this.insertComponent(world, rt, c.type, c.data as Record<string, unknown>);
    }
    // Link to a parent that is already spawned. setParent (not a raw Parent
    // insert) so the parent's Children list is maintained too — the UI layout's
    // buildDFS walks Children, so an insert-only link leaves the child out of
    // layout entirely (never laid out → stuck at the origin).
    if (entity.parent != null) {
      const pr = this.model.runtimeFor(entity.parent);
      if (pr != null) world.setParent(rt, pr);
    }
    // …and re-link any already-spawned children (undo-of-delete restores a
    // parent after its children, so the children await this re-parent).
    for (const childId of entity.children) {
      const cr = this.model.runtimeFor(childId);
      if (cr != null) world.setParent(cr, rt);
    }
    // Out-of-band: a TilemapLayer's `tilesetAssets` isn't an engine component field,
    // so insertComponent skips it. Live-push it to the tilemap plugin on spawn — this
    // is what makes create AND redo/reload restore a map's tileset with no create-time
    // special-casing (the map is a single, plain create step).
    const layer = entity.components.find((c) => c.type === 'TilemapLayer');
    if (layer) {
      const refs = (layer.data as Record<string, unknown>).tilesetAssets;
      const list = Array.isArray(refs) ? refs.filter((r): r is string => typeof r === 'string' && r !== '') : [];
      if (list.length > 0) TilemapLiveSync.setLayerTilesets(rt, list);
    }
    // Index this entity's own entity-ref edges (so a sibling spawned later finds
    // it), then re-project any ALREADY-SPAWNED component whose entity-ref field
    // points at THIS entity — undo-of-delete can restore a joint's connected body
    // after the joint itself, the same ordering the child re-link above repairs
    // for the hierarchy. Without this, that component's World copy keeps a dead
    // runtime id. The reverse index makes this O(referrers), not a full-model scan.
    for (const comp of entity.components) this.indexComponent(sourceId, comp);
    for (const { entity: refEntity, comp } of this.refIndex.referrersOf(sourceId)) {
      if (refEntity === sourceId || this.model.runtimeFor(refEntity) == null) continue;
      this.projectComponent(refEntity, comp);
    }
  }

  private despawnEntity(sourceId: number): void {
    const world = EngineHost.mutableWorld();
    const rt = this.model.runtimeFor(sourceId);
    if (world && rt != null && world.valid(rt)) world.despawn(rt);
    this.model.unbindRuntime(sourceId);
    this.refIndex.removeEntity(sourceId);
  }

  // ── Reverse entity-ref index ──────────────────────────────────────────────

  /** Rebuild the reverse index from the whole model (bulk load / clear). */
  private rebuildRefIndex(): void {
    this.refIndex.clear();
    for (const e of this.model.allSourceEntities()) {
      for (const comp of e.components) this.indexComponent(e.id, comp);
    }
  }

  /** Refresh the index edges for one component from its current model data. */
  private reindexComponent(sourceId: number, type: string): void {
    const comp = this.model.entityBySource(sourceId)?.components.find((c) => c.type === type);
    if (comp) this.indexComponent(sourceId, comp);
    else this.refIndex.setReferrer(sourceId, type, []);
  }

  /** Record (or clear) one component's entity-ref edges in the reverse index. */
  private indexComponent(sourceId: number, comp: { type: string; data: unknown }): void {
    const fields = componentEntityFields(componentByName(comp.type));
    if (fields.length === 0) return;
    const data = comp.data as Record<string, unknown>;
    const refs: number[] = [];
    for (const f of fields) {
      const v = data[f];
      if (typeof v === 'number') refs.push(v);
    }
    this.refIndex.setReferrer(sourceId, comp.type, refs);
  }

  private projectComponent(sourceId: number, type: string): void {
    if (STRUCTURAL.has(type)) return; // identity/structure handled by name/parent
    const world = EngineHost.mutableWorld();
    const rt = this.model.runtimeFor(sourceId);
    const entity = this.model.entityBySource(sourceId);
    if (!world || rt == null || !entity) return;
    const def = componentByName(type);
    if (!def) return; // unknown component — lives in the model only
    const comp = entity.components.find((c) => c.type === type);
    if (!comp) return;
    // Re-fold editor-hidden each time we project a render component, so a field
    // edit on a hidden entity doesn't quietly un-hide it in the viewport.
    const src = this.model.isHidden(sourceId) ? foldHidden(comp) : comp;
    const data = this.projectData(type, def, src.data as Record<string, unknown>);
    if (world.has(rt, def)) {
      // Readonly fields (Transform's world-space transform) are ENGINE-computed each
      // frame; the model carries a stale zero for them, and the value-object marshalling
      // needs every field present — so re-use the World's live-composed value instead of
      // clobbering it to the origin (which is what made a moving gizmo snap to 0,0).
      const readonly = readonlyFieldsFor(type);
      if (readonly.length) {
        const live = world.get(rt, def) as Record<string, unknown>;
        for (const k of readonly) if (k in live) data[k] = live[k];
      }
      world.set(rt, def, data as Parameters<WorldT['set']>[2]);
    } else {
      world.insert(rt, def, data as never);
    }
  }

  /** Re-project an entity's render components when its editor visibility flips. */
  private projectHidden(sourceId: number): void {
    const entity = this.model.entityBySource(sourceId);
    if (!entity) return;
    for (const c of entity.components) if (isRenderComponent(c.type)) this.projectComponent(sourceId, c.type);
  }

  private removeComponent(sourceId: number, type: string): void {
    if (STRUCTURAL.has(type)) return;
    const world = EngineHost.mutableWorld();
    const rt = this.model.runtimeFor(sourceId);
    if (!world || rt == null) return;
    const def = componentByName(type);
    if (def && world.has(rt, def)) world.remove(rt, def);
  }

  private projectParent(sourceId: number): void {
    const world = EngineHost.mutableWorld();
    const rt = this.model.runtimeFor(sourceId);
    const entity = this.model.entityBySource(sourceId);
    if (!world || rt == null || !entity) return;
    const pr = entity.parent != null ? this.model.runtimeFor(entity.parent) : undefined;
    // setParent/removeParent maintain both sides (child's Parent + parent's
    // Children) — a raw Parent insert leaves the parent's Children stale, which
    // drops the child out of the UI layout's buildDFS walk.
    if (pr != null) world.setParent(rt, pr);
    else world.removeParent(rt);
  }

  private projectName(sourceId: number): void {
    const world = EngineHost.mutableWorld();
    const rt = this.model.runtimeFor(sourceId);
    const entity = this.model.entityBySource(sourceId);
    if (!world || rt == null || !entity) return;
    world.insert(rt, Name, { value: entity.name } as never);
  }

  // ── Data projection (model SceneData shape → World component data) ─────────

  private insertComponent(
    world: WorldT,
    rt: EntityId,
    type: string,
    data: Record<string, unknown>,
  ): void {
    if (STRUCTURAL.has(type)) return;
    const def = componentByName(type);
    if (!def) return; // unknown — model only
    world.insert(rt, def, this.projectData(type, def, data) as never);
  }

  /**
   * Build the World-facing component data from the model's record: keep only the
   * fields the engine component knows (the World is lossy — schema-extra fields
   * stay in the model), and resolve asset refs to live GL handles. Asset fields
   * accept the same ref forms the scene loader does — `@uuid:` or a plain path.
   */
  private projectData(type: string, def: AnyComp, data: Record<string, unknown>): Record<string, unknown> {
    const defaults = componentDefaults(def);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(defaults)) {
      if (!(key in data)) {
        out[key] = defaults[key];
        continue;
      }
      out[key] = this.resolveFieldValue(type, key, data[key]);
    }
    // Entity-reference fields hold SOURCE ids in the model; the World speaks
    // RUNTIME ids (the bulk load remaps via the scene loader's remapEntityFields).
    // Re-projection must speak the same domain — a verbatim copy would flip an
    // edited component's refs back into source ids, which the World reads as
    // whatever runtime entity happens to wear that number. `v > 0` mirrors the
    // loader: 0 is the SDK's INVALID_ENTITY sentinel, so a ref to source id 0
    // stays inert on both paths (a known loader-convention quirk).
    for (const f of componentEntityFields(def)) {
      const v = out[f];
      if (typeof v === 'number' && v > 0) out[f] = this.model.runtimeFor(v) ?? -1;
    }
    return out;
  }

  /**
   * Resolve one component field for the World, by what the field IS: asset
   * slots → live handles (`@uuid:` or a plain path), spine slots → project
   * paths (they stay strings — the spine loaders fetch the pair themselves),
   * anything else deep-resolves stray `@uuid:` strings to handles.
   */
  private resolveFieldValue(type: string, key: string, v: unknown): unknown {
    if (typeof v === 'string') {
      if (spineSlotType(type, key)) return this.resolveSpineRef(v);
      const at = assetFieldType(type, key);
      if (at) {
        // Path-valued slots keep a project path (the runtime loader fetches the
        // file); handle-valued slots resolve to a live GL/native handle. Either
        // way a projected ref may be COLD (never loaded in this realm) — hand it
        // to the touch listener, whose async load + re-project makes it live.
        if (PATH_VALUED_ASSET_TYPES.has(at)) {
          if (v !== '') this.touchAsset?.(v, at);
          return this.resolveRefPath(v) ?? v;
        }
        const handle = this.resolveAsset(v);
        if (handle === 0 && v !== '') this.touchAsset?.(v, at);
        return handle;
      }
    }
    return this.resolveRefs(v);
  }

  private resolveSpineRef(ref: string): string {
    if (!ref.startsWith(UUID_PREFIX)) return ref;
    return this.resolveRefPath(ref) ?? ref;
  }

  /** Clone the scene with every engine-component field resolved via {@link
   *  resolveFieldValue} (both bulk paths — adopt and rebuild — project through this).
   *  Fields the engine component doesn't declare are left AS AUTHORED: they are the
   *  scene codec's out-of-band data (a TilemapLayer's `tilesetAsset(s)` ref list, its
   *  chunk blob), which `loadComponent` replays after the insert. Running those through
   *  the asset resolver would blank a `@uuid:` tileset ref to a 0 handle (tilesets are
   *  path/ref-valued, not texture handles), so the codec would then drop it — and the
   *  layer would render nothing. Unknown components are stripped by worldProjection
   *  next, so resolving their fields here is harmless; leave that path unchanged. */
  private resolveSceneRefs(data: SceneData): SceneData {
    return {
      ...data,
      entities: (data.entities ?? []).map((e) => ({
        ...e,
        components: (e.components ?? []).map((c) => {
          const d = c.data as Record<string, unknown> | undefined;
          if (!d) return c;
          const def = componentByName(c.type);
          const fields = def ? componentDefaults(def) : null;
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(d)) {
            out[k] = fields && !(k in fields) ? v : this.resolveFieldValue(c.type, k, v);
          }
          return { ...c, data: out };
        }),
      })),
    } as SceneData;
  }

  /** Recursively replace `@uuid:<id>` strings with resolved asset handles. */
  private resolveRefs(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.startsWith(UUID_PREFIX) ? this.resolveAsset(value) : value;
    }
    if (Array.isArray(value)) return value.map((v) => this.resolveRefs(v));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = this.resolveRefs(v);
      return out;
    }
    return value;
  }
}

/** The app's default-session reconciler. Other sessions construct their own ReconcilerImpl(model). */
export const Reconciler = new ReconcilerImpl(SceneModel);
