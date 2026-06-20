import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';

type SceneEntity = SceneData['entities'][number];
type SceneComponent = SceneEntity['components'][number];

/**
 * The editor's source-of-truth scene data model — JSON-first (REARCH_SERIALIZATION.md, L1).
 *
 * Holds the COMPLETE loaded SceneData: components/fields/entities the live World
 * drops on projection (unknown component types, schema-extra fields,
 * `visible:false` entities) and portable `@uuid:` asset refs, all preserved here
 * verbatim. The World is a lossy render projection of this model; lossless save
 * serializes THIS, not the World.
 *
 * L1 (this step): adopt + retain the model and the model⇄runtime-entity
 * correspondence on load. L3 will route edits through here; L4 will save from
 * here (and retire the editor's `lossy` refuse-to-save guard).
 */
class SceneModelImpl {
  private data: SceneData | null = null;
  /** runtime World entity → this scene's source entity id. */
  private readonly runtimeToSource = new Map<EntityId, number>();
  /** source entity id → runtime World entity (absent for visible:false / unspawned). */
  private readonly sourceToRuntime = new Map<number, EntityId>();
  /** Allocator for source ids of entities created after load (added/duplicated). */
  private nextSourceId = 1;

  /**
   * Adopt a freshly-loaded scene as the editor truth.
   * @param loaded   the complete SceneData (with `@uuid:` refs + unknown components)
   * @param entityMap source-id → runtime entity, as returned by resetWorldTo / loadSceneData
   */
  adopt(loaded: SceneData, entityMap: Map<number, EntityId>): void {
    this.data = loaded;
    this.runtimeToSource.clear();
    this.sourceToRuntime.clear();
    let maxId = 0;
    for (const e of loaded.entities) if (e.id > maxId) maxId = e.id;
    this.nextSourceId = maxId + 1;
    for (const [sourceId, runtime] of entityMap) {
      this.sourceToRuntime.set(sourceId, runtime);
      this.runtimeToSource.set(runtime, sourceId);
    }
  }

  clear(): void {
    this.data = null;
    this.runtimeToSource.clear();
    this.sourceToRuntime.clear();
    this.nextSourceId = 1;
  }

  // ── Mutations (JSON-first L3) ────────────────────────────────────────────
  // SceneCommands dual-writes here alongside the World so the model stays the
  // lossless truth. Field edits address the live runtime entity; entity
  // lifecycle addresses the stable source id (survives undo/redo recreates,
  // where the runtime id changes). All are no-ops if no scene is loaded.

  /**
   * Update one field of a component on a runtime entity's source record.
   * Preserves every other field — including `@uuid:` asset refs and schema-extra
   * fields the World can't hold — so the model stays lossless. Mirrors the
   * per-key value SceneCommands writes to the World.
   */
  setField(runtime: EntityId, compType: string, key: string, value: unknown): void {
    const e = this.sourceEntity(runtime);
    if (!e) return;
    let comp = e.components.find((c) => c.type === compType);
    if (!comp) {
      comp = { type: compType, data: {} } as SceneComponent;
      e.components.push(comp);
    }
    (comp.data as Record<string, unknown>)[key] = value;
  }

  /** Set a runtime entity's name (stored top-level in SceneData, not as a component). */
  setName(runtime: EntityId, name: string): void {
    const e = this.sourceEntity(runtime);
    if (e) e.name = name;
  }

  /** Add a new source entity (for a freshly-spawned runtime entity). Returns its source id. */
  addEntity(runtime: EntityId, name: string, components: SceneComponent[]): number {
    const id = this.nextSourceId++;
    if (this.data) this.data.entities.push({ id, name, parent: null, children: [], components });
    this.bindRuntime(id, runtime);
    return id;
  }

  /** Remove + return a source entity by id (kept by undo closures to restore later). */
  removeEntityBySource(sourceId: number): SceneEntity | undefined {
    const rt = this.sourceToRuntime.get(sourceId);
    if (rt !== undefined) this.runtimeToSource.delete(rt);
    this.sourceToRuntime.delete(sourceId);
    if (!this.data) return undefined;
    const idx = this.data.entities.findIndex((e) => e.id === sourceId);
    return idx >= 0 ? this.data.entities.splice(idx, 1)[0] : undefined;
  }

  /** Re-insert a previously-removed source entity, bound to a (re-created) runtime entity. */
  restoreEntity(entity: SceneEntity, runtime: EntityId): void {
    if (this.data) this.data.entities.push(entity);
    this.bindRuntime(entity.id, runtime);
  }

  /** Point a source id at its current runtime entity (call after a recreate). */
  bindRuntime(sourceId: number, runtime: EntityId): void {
    this.sourceToRuntime.set(sourceId, runtime);
    this.runtimeToSource.set(runtime, sourceId);
  }

  /**
   * Re-parent a runtime entity in the source model (mirrors the World's Parent
   * component). Keeps both the child's `parent` link and the old/new parents'
   * `children` arrays consistent so the saved scene's hierarchy stays correct.
   */
  setParent(runtimeChild: EntityId, runtimeParent: EntityId | null): void {
    const child = this.sourceEntity(runtimeChild);
    if (!child || !this.data) return;
    const newParentId = runtimeParent != null ? this.sourceFor(runtimeParent) ?? null : null;
    if (child.parent === newParentId) return;

    if (child.parent != null) {
      const old = this.data.entities.find((e) => e.id === child.parent);
      if (old) old.children = old.children.filter((c) => c !== child.id);
    }
    child.parent = newParentId;
    if (newParentId != null) {
      const np = this.data.entities.find((e) => e.id === newParentId);
      if (np && !np.children.includes(child.id)) np.children.push(child.id);
    }
  }

  /** The current scene truth, or null if none loaded. */
  get current(): SceneData | null {
    return this.data;
  }

  /** A deep clone of the scene truth, for lossless save (JSON-first L4). */
  serialize(): SceneData | null {
    return this.data ? (JSON.parse(JSON.stringify(this.data)) as SceneData) : null;
  }

  /** The source entity record backing a runtime World entity, if tracked. */
  sourceEntity(runtime: EntityId): SceneEntity | undefined {
    const sourceId = this.runtimeToSource.get(runtime);
    if (sourceId === undefined || !this.data) return undefined;
    return this.data.entities.find((e) => e.id === sourceId);
  }

  /** Runtime World entity for a source id (if currently spawned). */
  runtimeFor(sourceId: number): EntityId | undefined {
    return this.sourceToRuntime.get(sourceId);
  }
  /** Source id for a runtime World entity (if tracked). */
  sourceFor(runtime: EntityId): number | undefined {
    return this.runtimeToSource.get(runtime);
  }
}

export const SceneModel = new SceneModelImpl();
