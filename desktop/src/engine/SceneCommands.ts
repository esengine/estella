import type { SceneData, PrefabData, ProcessedEntity } from 'esengine';
import type { EntityId, InspectorFieldType, InspectorFieldValue } from '@/types';
import { EditorHistory, EditorHistoryImpl } from './EditorHistory';
import { SceneModel, SceneModelImpl } from './SceneModel';
import { expandInstance } from './PrefabInstance';
import {
  componentByName,
  componentDefaults,
  userSchema,
  angleZToQuat,
  hexToRgb,
  prettyLabel,
} from './schema';

type SceneEntity = SceneData['entities'][number];
type SceneComponent = SceneEntity['components'][number];

// — Model-authoritative commands (REARCH_EDITOR_MODEL.md) —
//
// Every mutation edits the SceneModel ONLY (the session's source of truth). The
// model emits a change event; the Reconciler projects it to the World. Nothing
// here touches the World — so the World is a pure derived projection that cannot
// desync. Undo records MODEL operations (lossless by construction: the model
// holds every component, incl. unknown ones + @uuid: refs + the parent link).
//
// All ids are stable **source ids** — the editor's id space (the viewport
// resolves a runtime pick to its source id before calling in). Commands are an
// instance bound to a session's model + history (EditorSession), so they can be
// isolated per session/test; `SceneCommands` is the app's default-session one.

const DEFAULT_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { w: 1, x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

const editKey = (sourceId: number, comp: string, key: string) => `${sourceId}|${comp}|${key}`;

// Value equality over the SceneData-format shapes a field can hold (number /
// bool / string / vec / quat / color object). JSON compare is exact for these.
const valueEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Convert an inspector control value to its SceneData-format model value,
 * merging into the current value where the control edits a slice (vec
 * components keep the untouched axis; color keeps alpha). 2D rotation is stored
 * as a quaternion; angle controls convert degrees↔quat.
 */
export function toModelValue(
  cur: Record<string, unknown>,
  type: InspectorFieldType,
  key: string,
  value: InspectorFieldValue,
): unknown {
  switch (type) {
    case 'number':
      return Number(value);
    case 'bool':
      return Boolean(value);
    case 'string':
      return String(value);
    case 'vec2': {
      const [x, y] = value as [number, number];
      return { ...(cur[key] as object), x, y };
    }
    case 'vec3': {
      const [x, y, z] = value as [number, number, number];
      return { ...(cur[key] as object), x, y, z };
    }
    case 'angle':
      return angleZToQuat(Number(value));
    case 'color': {
      const a = (cur[key] as { a?: number } | undefined)?.a ?? 1;
      return { ...(cur[key] as object), ...hexToRgb(String(value)), a };
    }
    default:
      return value;
  }
}

interface FieldEdit {
  sourceId: number;
  comp: string;
  key: string;
  before: unknown; // model (SceneData-format) value before the gesture
}

export class SceneCommandsImpl {
  // — Field-edit gesture: coalesce a focus→blur / drag into a single undo step. —
  // Undo recording is INTERNAL: the only public write door is `setField` (and
  // `setEntityXY`, which routes through it), and it always records. Outside a
  // gesture, one `setField` = one undo step. Inside a gesture, writes coalesce —
  // the BEFORE model value is captured on first touch of each field, the AFTER
  // value read at `endGesture`, and the pair recorded as one model-op step.
  private gesture: { label: string; touched: Map<string, FieldEdit> } | null = null;

  constructor(
    private readonly model: SceneModelImpl,
    private readonly history: EditorHistoryImpl,
  ) {}

  /** The current model value of one field, or undefined. */
  private modelFieldValue(sourceId: number, comp: string, key: string): unknown {
    const c = this.model.entityBySource(sourceId)?.components.find((c) => c.type === comp);
    return c ? (c.data as Record<string, unknown>)[key] : undefined;
  }

  // True if walking up from `nodeSrc` reaches `ancestorSrc` — rejects re-parenting
  // an entity under its own descendant (a cycle). Reads the model hierarchy.
  private isModelAncestor(nodeSrc: number, ancestorSrc: number): boolean {
    let cur: number | null = nodeSrc;
    const seen = new Set<number>();
    while (cur != null) {
      if (cur === ancestorSrc) return true;
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = this.model.entityBySource(cur)?.parent ?? null;
    }
    return false;
  }

  /**
   * Open a coalescing edit gesture. Every `setField` until {@link endGesture}
   * folds into one undo step. Idempotent-safe: a dangling gesture is committed
   * before a new one opens.
   */
  beginGesture(label: string): void {
    if (this.gesture) this.endGesture();
    this.gesture = { label, touched: new Map() };
  }

  /** Close the current gesture, recording all coalesced field edits as one undo step. */
  endGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g || g.touched.size === 0) return;
    const edits = [...g.touched.values()]
      .map((e) => ({ ...e, after: structuredClone(this.modelFieldValue(e.sourceId, e.comp, e.key)) }))
      .filter((e) => !valueEqual(e.before, e.after));
    if (edits.length === 0) return;
    this.history.record(
      g.label,
      () => edits.forEach((e) => this.model.setField(e.sourceId, e.comp, e.key, e.after)),
      () => edits.forEach((e) => this.model.setField(e.sourceId, e.comp, e.key, e.before)),
    );
  }

  /**
   * Write a single inspector field to the model (the Reconciler re-projects it
   * to the World). Always undoable: coalesced into an open gesture, else its own step.
   */
  setField(
    sourceId: EntityId,
    compName: string,
    key: string,
    type: InspectorFieldType,
    value: InspectorFieldValue,
  ): void {
    const e = this.model.entityBySource(sourceId);
    if (!e) return;
    const cur = (e.components.find((c) => c.type === compName)?.data as Record<string, unknown>) ?? {};

    const k = editKey(sourceId, compName, key);
    const firstTouch = !this.gesture || !this.gesture.touched.has(k);
    const before = firstTouch ? structuredClone(cur[key]) : undefined;

    const after = toModelValue(cur, type, key, value);
    this.model.setField(sourceId, compName, key, after);

    if (this.gesture) {
      if (firstTouch) this.gesture.touched.set(k, { sourceId, comp: compName, key, before });
      return;
    }
    // No open gesture → this edit is its own undo step.
    if (valueEqual(before, after)) return;
    this.history.record(
      `Edit ${prettyLabel(key)}`,
      () => this.model.setField(sourceId, compName, key, after),
      () => this.model.setField(sourceId, compName, key, before),
    );
  }

  /** Move an entity to a world position (keeps Z). Undoable like any field edit. */
  setEntityXY(sourceId: EntityId, x: number, y: number): void {
    const pos = this.modelFieldValue(sourceId, 'Transform', 'position') as { z?: number } | undefined;
    if (pos === undefined && !this.model.entityBySource(sourceId)) return;
    this.setField(sourceId, 'Transform', 'position', 'vec3', [x, y, pos?.z ?? 0]);
  }

  // — Undoable entity lifecycle (model ops; the Reconciler re-spawns/-despawns) —

  /** Spawn a new empty entity (with a Transform). Returns its source id. */
  addEntity(): EntityId | null {
    if (!this.model.current) return null;
    const sourceId = this.model.addEntity('Entity', [
      { type: 'Transform', data: structuredClone(DEFAULT_TRANSFORM) } as SceneComponent,
    ]);
    let record: SceneEntity | undefined;
    this.history.record(
      'Add Entity',
      () => {
        if (record) this.model.restoreEntity(record);
      },
      () => {
        record = this.model.removeEntityBySource(sourceId);
      },
    );
    return sourceId;
  }

  /**
   * Delete an entity AND its descendants (the World despawns children with their
   * parent, so the model removes the whole subtree to stay consistent). Undo
   * re-creates the subtree losslessly, parent-before-child. Records are kept
   * parent-first so restore re-links each child to its (already-restored) parent.
   */
  deleteEntity(sourceId: EntityId): void {
    const entity = this.model.entityBySource(sourceId);
    if (!entity) return;
    const name = entity.name || 'Entity';
    const remove = (): SceneEntity[] =>
      this.model
        .collectSubtree(sourceId)
        .map((id) => this.model.removeEntityBySource(id))
        .filter((r): r is SceneEntity => r !== undefined);

    let records = remove();
    if (records.length === 0) return;
    this.history.record(
      `Delete ${name}`,
      () => {
        records = remove(); // redo
      },
      () => {
        for (const r of records) this.model.restoreEntity(r); // parent-first
      },
    );
  }

  /** Duplicate an entity (offset slightly, as a sibling). Returns the new source id. */
  duplicateEntity(sourceId: EntityId): EntityId | null {
    const src = this.model.entityBySource(sourceId);
    if (!src) return null;
    // Clone the SOURCE record (preserves unknown components/fields + @uuid: refs
    // the World projection can't carry), with the standard paste offset.
    const components = structuredClone(src.components) as SceneComponent[];
    const pos = (components.find((c) => c.type === 'Transform')?.data as
      | { position?: { x: number; y: number } }
      | undefined)?.position;
    if (pos) {
      pos.x += 24;
      pos.y -= 24;
    }
    const newSourceId = this.model.addEntity(src.name, components, src.parent ?? null);
    let record: SceneEntity | undefined;
    this.history.record(
      `Duplicate ${src.name || 'Entity'}`,
      () => {
        if (record) this.model.restoreEntity(record);
      },
      () => {
        record = this.model.removeEntityBySource(newSourceId);
      },
    );
    return newSourceId;
  }

  /**
   * Instantiate a prefab into the scene under `parent` (REARCH_PREFABS.md PF2):
   * expand the asset into the model as ordinary entities (the Reconciler spawns
   * them), tagged with their prefab origin so save can collapse the subtree back
   * to a delta. The caller (ProjectStore / UI) loads the PrefabData asset; this
   * stays synchronous + undoable. Returns the instance root's source id.
   */
  instantiatePrefab(
    prefab: PrefabData,
    ref: string,
    parent: EntityId | null,
    position?: { x: number; y: number },
  ): EntityId | null {
    if (!this.model.current) return null;
    const { entities, rootId } = expandInstance(
      prefab,
      { prefab: ref, overrides: [], added: [], removed: [] },
      () => this.model.allocateSourceId(),
    );
    const root = entities.find((e) => e.id === rootId);
    if (!root) return null;
    root.parent = parent; // attach under the scene parent

    // Place the instance at the drop point — a Transform.position edit that
    // diffAgainstSource captures as a property override on save (so the prefab
    // asset stays at its authored origin; the instance carries the placement).
    if (position) {
      const tf = root.components.find((c) => c.type === 'Transform');
      if (tf) {
        const p = ((tf.data as Record<string, unknown>).position ??= { x: 0, y: 0, z: 0 }) as { x: number; y: number; z: number };
        p.x = position.x;
        p.y = position.y;
      }
    }

    // ProcessedEntity → SceneEntity (drop prefab fields); deep-clone components so
    // later edits to the instance don't leak into the redo record.
    const toScene = (e: ProcessedEntity): SceneEntity =>
      ({
        id: e.id,
        name: e.name,
        parent: e.parent,
        children: e.children,
        components: structuredClone(e.components),
        visible: e.visible,
      }) as unknown as SceneEntity;

    const apply = (): void => {
      this.model.insertSubtree(entities.map(toScene));
      for (const e of entities) {
        this.model.setPrefabTag(e.id, {
          instanceRoot: rootId,
          prefabId: e.prefabEntityId,
          prefab: e.id === rootId ? ref : undefined,
        });
      }
    };
    apply();
    this.history.record(`Instantiate ${prefab.name || 'Prefab'}`, apply, () => {
      for (const id of this.model.collectSubtree(rootId)) this.model.removeEntityBySource(id);
    });
    return rootId;
  }

  /** Rename an entity (undoable). */
  renameEntity(sourceId: EntityId, name: string): void {
    const before = this.model.entityBySource(sourceId)?.name;
    if (before === undefined || before === name) return;
    this.model.setName(sourceId, name);
    this.history.record(
      `Rename ${name || 'Entity'}`,
      () => this.model.setName(sourceId, name),
      () => this.model.setName(sourceId, before),
    );
  }

  /**
   * Re-parent an entity (drag-reparent). Undoable. Rejects self-parenting and
   * cycles (parenting under its own descendant); `parent: null` un-parents.
   */
  setParent(sourceId: EntityId, parent: EntityId | null): void {
    if (!this.model.entityBySource(sourceId)) return;
    if (parent != null && (parent === sourceId || this.isModelAncestor(parent, sourceId))) return;
    const before = this.model.entityBySource(sourceId)?.parent ?? null;
    if (before === parent) return;
    this.model.setParent(sourceId, parent);
    this.history.record(
      'Reparent',
      () => this.model.setParent(sourceId, parent),
      () => this.model.setParent(sourceId, before),
    );
  }

  /** Add a component (with its registered/schema defaults) to an entity. Undoable. */
  addComponent(sourceId: EntityId, compName: string): void {
    const entity = this.model.entityBySource(sourceId);
    if (!entity || entity.components.some((c) => c.type === compName)) return;
    const def = componentByName(compName);
    // Builtins default from the engine registry; user/script components from the
    // schemas.json shape; an unknown-but-named component starts empty.
    const data = def
      ? structuredClone(componentDefaults(def))
      : structuredClone(userSchema(compName)?.default ?? {});
    this.model.setComponent(sourceId, compName, data);
    this.history.record(
      `Add ${prettyLabel(compName)}`,
      () => this.model.setComponent(sourceId, compName, structuredClone(data)),
      () => this.model.removeComponent(sourceId, compName),
    );
  }

  /** Remove a component from an entity (Transform / Name are protected). Undoable. */
  removeComponent(sourceId: EntityId, compName: string): void {
    if (compName === 'Transform' || compName === 'Name') return;
    const comp = this.model.entityBySource(sourceId)?.components.find((c) => c.type === compName);
    if (!comp) return;
    const data = structuredClone(comp.data);
    this.model.removeComponent(sourceId, compName);
    this.history.record(
      `Remove ${prettyLabel(compName)}`,
      () => this.model.removeComponent(sourceId, compName),
      () => this.model.setComponent(sourceId, compName, structuredClone(data)),
    );
  }

  /**
   * Toggle an entity's editor visibility by flipping the `enabled` field of each
   * of its components that has one (coalesced into one undo step). Lossless +
   * persisted; SceneQuery reflects it as the row's visibility.
   */
  setEntityVisible(sourceId: EntityId, visible: boolean): void {
    const entity = this.model.entityBySource(sourceId);
    if (!entity) return;
    this.beginGesture(visible ? 'Show' : 'Hide');
    for (const comp of entity.components) {
      const data = comp.data as Record<string, unknown>;
      if (data && typeof data === 'object' && 'enabled' in data) {
        this.setField(sourceId, comp.type, 'enabled', 'bool', visible);
      }
    }
    this.endGesture();
  }
}

/** The app's default-session commands. Other sessions construct their own SceneCommandsImpl(model, history). */
export const SceneCommands = new SceneCommandsImpl(SceneModel, EditorHistory);
