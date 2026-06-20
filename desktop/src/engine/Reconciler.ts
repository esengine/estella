import { Name, Parent, resetWorldTo } from 'esengine';
import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';
import { EngineHost } from './EngineHost';
import { SceneModel, type ModelEvent } from './SceneModel';
import { componentByName, componentDefaults, type AnyComp, type WorldT } from './schema';

/**
 * Projects the model into the World (REARCH_EDITOR_MODEL.md §3.3).
 *
 * The invariant the whole rearchitecture rests on: **the World is a pure
 * function of the Model.** Commands mutate the model only; the model emits a
 * change event; this reconciler is the SINGLE place that writes the World in
 * response. There is no other path from a command to the World, so the two
 * cannot diverge.
 *
 * It owns the source↔runtime entity binding (via SceneModel.bindRuntime/
 * unbindRuntime) since it is what spawns and despawns. Components the engine
 * doesn't know stay in the model only — the World is a lossy render projection,
 * so unknown components / schema-extra fields / `@uuid:` refs never reach it.
 */

const UUID_PREFIX = '@uuid:';
/** Structural/identity components projected explicitly (name, parent), not as data. */
const STRUCTURAL = new Set(['Name', 'Parent', 'Children']);

type AssetResolver = (uuid: string) => number;
const UNRESOLVED: AssetResolver = () => 0;

class ReconcilerImpl {
  private unsubscribe: (() => void) | null = null;
  private resolveAsset: AssetResolver = UNRESOLVED;

  /** Begin projecting model changes to the World. Idempotent. */
  attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = SceneModel.subscribe((ev) => this.onEvent(ev));
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Install the `@uuid:` → GL-handle resolver. ProjectStore sets this after
   * loading a scene's textures, so entities recreated incrementally (duplicate,
   * undo-of-delete) re-resolve their asset refs the same way load does. Defaults
   * to "unresolved" (blank to 0) — fine for tests and ref-free scenes.
   */
  setAssetResolver(fn: AssetResolver | null): void {
    this.resolveAsset = fn ?? UNRESOLVED;
  }

  /**
   * Bulk path (boot / project load / play-stop): build the World from a resolved
   * scene and adopt the raw scene as the model. `resetWorldTo` returns source-id
   * → runtime; SceneModel.adopt records the map and announces a `reset`. This
   * reconciler ignores its own `reset` (the World is already built here).
   */
  adopt(rawData: SceneData, resolvedData: SceneData): void {
    const world = EngineHost.mutableWorld();
    if (!world) return;
    const map = resetWorldTo(world, resolvedData as never) as Map<number, EntityId>;
    SceneModel.adopt(rawData, map);
  }

  /**
   * Rebuild the entire World from the current model (play-stop): resolve the
   * model's `@uuid:` refs, reset the World to it, and rebind the source↔runtime
   * map. The model is the untouched edit scene, so this discards whatever
   * gameplay did to the World during play. No-op if no scene/world.
   */
  rebuildWorld(): void {
    const world = EngineHost.mutableWorld();
    const data = SceneModel.current;
    if (!world || !data) return;
    const resolved = this.resolveRefs(data) as SceneData;
    const map = resetWorldTo(world, resolved as never) as Map<number, EntityId>;
    SceneModel.adopt(data, map);
  }

  // ── Event projection ──────────────────────────────────────────────────────

  private onEvent(ev: ModelEvent): void {
    switch (ev.kind) {
      case 'reset':
        return; // bulk path already built the World
      case 'entityAdded':
        return this.spawnEntity(ev.sourceId);
      case 'entityRemoved':
        return this.despawnEntity(ev.sourceId);
      case 'componentAdded':
      case 'componentChanged':
        return this.projectComponent(ev.sourceId, ev.type);
      case 'componentRemoved':
        return this.removeComponent(ev.sourceId, ev.type);
      case 'parentChanged':
        return this.projectParent(ev.sourceId);
      case 'nameChanged':
        return this.projectName(ev.sourceId);
    }
  }

  private spawnEntity(sourceId: number): void {
    const world = EngineHost.mutableWorld();
    const entity = SceneModel.entityBySource(sourceId);
    if (!world || !entity) return;

    const rt = world.spawn();
    SceneModel.bindRuntime(sourceId, rt);
    if (entity.name) world.insert(rt, Name, { value: entity.name } as never);
    for (const comp of entity.components) {
      this.insertComponent(world, rt, comp.type, comp.data as Record<string, unknown>);
    }
    // Link to a parent that is already spawned…
    if (entity.parent != null) {
      const pr = SceneModel.runtimeFor(entity.parent);
      if (pr != null) world.insert(rt, Parent, { entity: pr } as never);
    }
    // …and re-link any already-spawned children (undo-of-delete restores a
    // parent after its children, so the children await this re-parent).
    for (const childId of entity.children) {
      const cr = SceneModel.runtimeFor(childId);
      if (cr != null) world.insert(cr, Parent, { entity: rt } as never);
    }
  }

  private despawnEntity(sourceId: number): void {
    const world = EngineHost.mutableWorld();
    const rt = SceneModel.runtimeFor(sourceId);
    if (world && rt != null && world.valid(rt)) world.despawn(rt);
    SceneModel.unbindRuntime(sourceId);
  }

  private projectComponent(sourceId: number, type: string): void {
    if (STRUCTURAL.has(type)) return; // identity/structure handled by name/parent
    const world = EngineHost.mutableWorld();
    const rt = SceneModel.runtimeFor(sourceId);
    const entity = SceneModel.entityBySource(sourceId);
    if (!world || rt == null || !entity) return;
    const def = componentByName(type);
    if (!def) return; // unknown component — lives in the model only
    const comp = entity.components.find((c) => c.type === type);
    if (!comp) return;
    const data = this.projectData(def, comp.data as Record<string, unknown>);
    if (world.has(rt, def)) world.set(rt, def, data as Parameters<WorldT['set']>[2]);
    else world.insert(rt, def, data as never);
  }

  private removeComponent(sourceId: number, type: string): void {
    if (STRUCTURAL.has(type)) return;
    const world = EngineHost.mutableWorld();
    const rt = SceneModel.runtimeFor(sourceId);
    if (!world || rt == null) return;
    const def = componentByName(type);
    if (def && world.has(rt, def)) world.remove(rt, def);
  }

  private projectParent(sourceId: number): void {
    const world = EngineHost.mutableWorld();
    const rt = SceneModel.runtimeFor(sourceId);
    const entity = SceneModel.entityBySource(sourceId);
    if (!world || rt == null || !entity) return;
    const pr = entity.parent != null ? SceneModel.runtimeFor(entity.parent) : undefined;
    if (pr != null) world.insert(rt, Parent, { entity: pr } as never);
    else if (world.has(rt, Parent)) world.remove(rt, Parent);
  }

  private projectName(sourceId: number): void {
    const world = EngineHost.mutableWorld();
    const rt = SceneModel.runtimeFor(sourceId);
    const entity = SceneModel.entityBySource(sourceId);
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
    world.insert(rt, def, this.projectData(def, data) as never);
  }

  /**
   * Build the World-facing component data from the model's record: keep only the
   * fields the engine component knows (the World is lossy — schema-extra fields
   * stay in the model), and resolve `@uuid:` asset refs to live GL handles.
   */
  private projectData(def: AnyComp, data: Record<string, unknown>): Record<string, unknown> {
    const defaults = componentDefaults(def);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(defaults)) {
      out[key] = key in data ? this.resolveRefs(data[key]) : defaults[key];
    }
    return out;
  }

  /** Recursively replace `@uuid:<id>` strings with resolved asset handles. */
  private resolveRefs(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.startsWith(UUID_PREFIX) ? this.resolveAsset(value.slice(UUID_PREFIX.length)) : value;
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

export const Reconciler = new ReconcilerImpl();
