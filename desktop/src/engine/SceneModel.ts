import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';

type SceneEntity = SceneData['entities'][number];
type SceneComponent = SceneEntity['components'][number];

/**
 * A fine-grained change to the model. The {@link Reconciler} projects each event
 * to the World; SceneStore turns them into reactivity bumps; selection
 * self-heals on `entityRemoved`. `reset` means the whole model was replaced
 * (load/clear) — consumers rebuild from scratch.
 */
export type ModelEvent =
  | { kind: 'reset' }
  | { kind: 'entityAdded'; sourceId: number }
  | { kind: 'entityRemoved'; sourceId: number }
  | { kind: 'componentAdded'; sourceId: number; type: string }
  | { kind: 'componentChanged'; sourceId: number; type: string }
  | { kind: 'componentRemoved'; sourceId: number; type: string }
  | { kind: 'parentChanged'; sourceId: number }
  | { kind: 'nameChanged'; sourceId: number };

type Listener = (ev: ModelEvent) => void;

/**
 * Marks a model entity as part of a prefab instance (REARCH_PREFABS.md). The
 * editor expands a prefab instance into ordinary entities; these tags record
 * each entity's prefab origin so save can collapse the subtree back to a delta.
 * Editor-transient (never a World component); the Reconciler ignores them.
 */
export interface PrefabInstanceTag {
  /** The instance root's source id — groups the subtree. */
  instanceRoot: number;
  /** This entity's stable id within the prefab asset. */
  prefabId: string;
  /** The `@uuid:` ref to the prefab asset — set only on the instance root. */
  prefab?: string;
}

/**
 * The editor's single source of truth — the JSON-first scene document
 * (REARCH_EDITOR_MODEL.md). Holds the COMPLETE SceneData: components/fields the
 * live World drops on projection (unknown component types, schema-extra fields,
 * `visible:false` entities) and portable `@uuid:` asset refs, all verbatim.
 *
 * Model-authoritative data flow: commands mutate THIS (by stable **source id**),
 * the model emits a change event, and the {@link Reconciler} projects it to the
 * World. The World is a pure derived projection — it never writes back here, so
 * the two cannot diverge. Save serializes THIS, not the World (lossless).
 *
 * The source↔runtime entity map lives here (so the Viewport can resolve a
 * selected source id to its runtime World entity for picking/gizmo geometry),
 * but only the Reconciler writes it — via {@link bindRuntime}/{@link unbindRuntime}
 * as it spawns/despawns — so the map can never go stale against the World.
 */
export class SceneModelImpl {
  private data: SceneData | null = null;
  /** runtime World entity → source entity id (Reconciler-maintained). */
  private readonly runtimeToSource = new Map<EntityId, number>();
  /** source entity id → runtime World entity (absent for unknown/unspawned). */
  private readonly sourceToRuntime = new Map<number, EntityId>();
  /** Allocator for source ids of entities created after load (add/duplicate). */
  private nextSourceId = 1;
  /** source id → prefab-instance tag (editor-transient; see PrefabInstanceTag). */
  private readonly prefabTags = new Map<number, PrefabInstanceTag>();
  private readonly listeners = new Set<Listener>();

  // ── Change bus ───────────────────────────────────────────────────────────

  /** Subscribe to model changes. Returns an unsubscribe fn. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(ev: ModelEvent): void {
    for (const l of this.listeners) l(ev);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Adopt a freshly-loaded scene as the editor truth. The World is expected to
   * already be built (the Reconciler's bulk path calls resetWorldTo, then this),
   * so adopt only records the model + the source↔runtime map and announces a
   * wholesale `reset` for reactivity / selection.
   * @param loaded   the complete SceneData (with `@uuid:` refs + unknown components)
   * @param entityMap source-id → runtime entity, as returned by resetWorldTo
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
    this.emit({ kind: 'reset' });
  }

  clear(): void {
    this.data = null;
    this.runtimeToSource.clear();
    this.sourceToRuntime.clear();
    this.prefabTags.clear();
    this.nextSourceId = 1;
    this.emit({ kind: 'reset' });
  }

  /** Reserve a fresh source id (for entities added outside addEntity — e.g. a
   *  prefab instance's expanded subtree, which arrives pre-formed). */
  allocateSourceId(): number {
    return this.nextSourceId++;
  }

  // ── Mutations (the ONLY writers; each emits a change event) ───────────────
  // Keyed by stable source id (survives undo/redo recreates, where the runtime
  // id changes). All are no-ops if no scene is loaded. Values are SceneData-
  // format — the command layer converts inspector controls to this shape, the
  // reconciler projects this shape to the World.

  /**
   * Update one field of a component on a source entity. Preserves every other
   * field — including `@uuid:` asset refs and schema-extra fields the World
   * can't hold — so the model stays lossless. Creates the component if absent.
   */
  setField(sourceId: number, compType: string, key: string, value: unknown): void {
    const e = this.entityBySource(sourceId);
    if (!e) return;
    let comp = e.components.find((c) => c.type === compType);
    if (!comp) {
      comp = { type: compType, data: {} } as SceneComponent;
      e.components.push(comp);
    }
    (comp.data as Record<string, unknown>)[key] = value;
    this.emit({ kind: 'componentChanged', sourceId, type: compType });
  }

  /**
   * Add or replace a whole component's data on a source entity. Adding a new
   * component changes the entity's component SET (structural — affects the tree's
   * kind/add-menu), so it emits `componentAdded`; replacing existing data is a
   * value change (`componentChanged`).
   */
  setComponent(sourceId: number, compType: string, data: unknown): void {
    const e = this.entityBySource(sourceId);
    if (!e) return;
    const existing = e.components.find((c) => c.type === compType);
    if (existing) {
      existing.data = data as Record<string, unknown>;
      this.emit({ kind: 'componentChanged', sourceId, type: compType });
    } else {
      e.components.push({ type: compType, data: data as Record<string, unknown> } as SceneComponent);
      this.emit({ kind: 'componentAdded', sourceId, type: compType });
    }
  }

  /** Remove a component from a source entity. */
  removeComponent(sourceId: number, compType: string): void {
    const e = this.entityBySource(sourceId);
    if (!e) return;
    e.components = e.components.filter((c) => c.type !== compType);
    this.emit({ kind: 'componentRemoved', sourceId, type: compType });
  }

  /** Set a source entity's name (stored top-level in SceneData, not as a component). */
  setName(sourceId: number, name: string): void {
    const e = this.entityBySource(sourceId);
    if (!e) return;
    e.name = name;
    this.emit({ kind: 'nameChanged', sourceId });
  }

  /**
   * Add a new source entity. Returns its source id. The Reconciler spawns +
   * binds a runtime entity in response to the emitted `entityAdded`.
   */
  addEntity(name: string, components: SceneComponent[], parent: number | null = null): number {
    const id = this.nextSourceId++;
    if (this.data) {
      this.data.entities.push({ id, name, parent, children: [], components });
      if (parent != null) {
        const p = this.data.entities.find((e) => e.id === parent);
        if (p && !p.children.includes(id)) p.children.push(id);
      }
    }
    this.emit({ kind: 'entityAdded', sourceId: id });
    return id;
  }

  /**
   * Remove + return a source entity by id (kept by undo closures to restore
   * later). Scrubs the child id from its parent's `children[]` so the saved
   * hierarchy stays consistent. The source↔runtime map is left to the Reconciler
   * to unbind on the emitted `entityRemoved`.
   */
  removeEntityBySource(sourceId: number): SceneEntity | undefined {
    if (!this.data) return undefined;
    const idx = this.data.entities.findIndex((e) => e.id === sourceId);
    if (idx < 0) return undefined;
    const [removed] = this.data.entities.splice(idx, 1);
    if (removed.parent != null) {
      const p = this.data.entities.find((e) => e.id === removed.parent);
      if (p) p.children = p.children.filter((c) => c !== sourceId);
    }
    this.prefabTags.delete(sourceId);
    this.emit({ kind: 'entityRemoved', sourceId });
    return removed;
  }

  /**
   * Re-insert a previously-removed source entity (undo of delete). Restores its
   * link in the parent's `children[]`. The Reconciler respawns + binds a fresh
   * runtime entity on the emitted `entityAdded`.
   */
  restoreEntity(entity: SceneEntity): void {
    if (!this.data) return;
    this.data.entities.push(entity);
    if (entity.parent != null) {
      const p = this.data.entities.find((e) => e.id === entity.parent);
      if (p && !p.children.includes(entity.id)) p.children.push(entity.id);
    }
    this.emit({ kind: 'entityAdded', sourceId: entity.id });
  }

  /**
   * Re-parent a source entity. Keeps both the child's `parent` link and the
   * old/new parents' `children[]` consistent so the saved hierarchy is correct.
   * `parent: null` un-parents to the scene root.
   */
  setParent(sourceId: number, parent: number | null): void {
    const child = this.entityBySource(sourceId);
    if (!child || !this.data) return;
    if (child.parent === parent) return;

    if (child.parent != null) {
      const old = this.data.entities.find((e) => e.id === child.parent);
      if (old) old.children = old.children.filter((c) => c !== sourceId);
    }
    child.parent = parent;
    if (parent != null) {
      const np = this.data.entities.find((e) => e.id === parent);
      if (np && !np.children.includes(sourceId)) np.children.push(sourceId);
    }
    this.emit({ kind: 'parentChanged', sourceId });
  }

  // ── Source↔runtime map (Reconciler-only writers) ─────────────────────────

  /** Bind a source id to its current runtime entity (Reconciler, on spawn). */
  bindRuntime(sourceId: number, runtime: EntityId): void {
    this.sourceToRuntime.set(sourceId, runtime);
    this.runtimeToSource.set(runtime, sourceId);
  }

  /** Drop a source id's runtime binding (Reconciler, on despawn). */
  unbindRuntime(sourceId: number): void {
    const rt = this.sourceToRuntime.get(sourceId);
    if (rt !== undefined) this.runtimeToSource.delete(rt);
    this.sourceToRuntime.delete(sourceId);
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** The current scene truth, or null if none loaded. */
  get current(): SceneData | null {
    return this.data;
  }

  /** A deep clone of the scene truth, for lossless save. */
  serialize(): SceneData | null {
    return this.data ? (JSON.parse(JSON.stringify(this.data)) as SceneData) : null;
  }

  /** The source entity record for a source id. */
  entityBySource(sourceId: number): SceneEntity | undefined {
    return this.data?.entities.find((e) => e.id === sourceId);
  }

  /**
   * A source id + all its descendants, **parent-before-child** — for recursive
   * delete (the World despawns a parent's children too, so the model must remove
   * the whole subtree to stay consistent) and ordered restore on undo.
   */
  collectSubtree(sourceId: number): number[] {
    const out: number[] = [];
    const visit = (id: number): void => {
      const e = this.entityBySource(id);
      if (!e) return;
      out.push(id);
      for (const child of e.children) visit(child);
    };
    visit(sourceId);
    return out;
  }

  // ── Prefab instances (REARCH_PREFABS.md) ──────────────────────────────────

  /** Tag an entity as part of a prefab instance (or pass undefined to clear). */
  setPrefabTag(sourceId: number, tag: PrefabInstanceTag | undefined): void {
    if (tag) this.prefabTags.set(sourceId, tag);
    else this.prefabTags.delete(sourceId);
  }

  /** The prefab-instance tag for an entity, if it belongs to one. */
  prefabTag(sourceId: number): PrefabInstanceTag | undefined {
    return this.prefabTags.get(sourceId);
  }

  /**
   * Insert a pre-formed, self-consistent subtree of entities (e.g. an expanded
   * prefab instance) whose ids are already allocated (via {@link allocateSourceId}).
   * Links each batch root into its existing parent's `children`, advances the
   * allocator past any incoming id, and emits `entityAdded` parent-before-child
   * so the Reconciler spawns parents first.
   */
  insertSubtree(entities: SceneEntity[]): void {
    if (!this.data || entities.length === 0) return;
    const batch = new Set(entities.map((e) => e.id));
    for (const e of entities) {
      if (e.id >= this.nextSourceId) this.nextSourceId = e.id + 1;
      this.data.entities.push(e);
    }
    // Attach batch roots (parent outside the batch) to their parent's children.
    for (const e of entities) {
      if (e.parent != null && !batch.has(e.parent)) {
        const p = this.entityBySource(e.parent);
        if (p && !p.children.includes(e.id)) p.children.push(e.id);
      }
    }
    // Parent-before-child emit order (parents in the batch first).
    const byId = new Map(entities.map((e) => [e.id, e]));
    const done = new Set<number>();
    const order: SceneEntity[] = [];
    const visit = (e: SceneEntity): void => {
      if (done.has(e.id)) return;
      const p = e.parent != null ? byId.get(e.parent) : undefined;
      if (p) visit(p);
      done.add(e.id);
      order.push(e);
    };
    for (const e of entities) visit(e);
    for (const e of order) this.emit({ kind: 'entityAdded', sourceId: e.id });
  }

  /** The source entity record backing a runtime World entity, if tracked. */
  sourceEntity(runtime: EntityId): SceneEntity | undefined {
    const sourceId = this.runtimeToSource.get(runtime);
    return sourceId === undefined ? undefined : this.entityBySource(sourceId);
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

/** The app's default-session model. Other sessions construct their own SceneModelImpl. */
export const SceneModel = new SceneModelImpl();
