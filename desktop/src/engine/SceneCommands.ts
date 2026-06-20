import type { SceneData } from 'esengine';
import type { EntityId, InspectorFieldType, InspectorFieldValue } from '@/types';
import { EditorHistory } from './EditorHistory';
import { SceneModel } from './SceneModel';
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
// Every mutation edits the SceneModel ONLY (the single source of truth). The
// model emits a change event; the Reconciler projects it to the World. Nothing
// here touches the World — so the World is a pure derived projection that cannot
// desync. Undo records MODEL operations (lossless by construction: the model
// holds every component, incl. unknown ones + @uuid: refs + the parent link).
//
// All ids are stable **source ids** — the editor's id space (the viewport
// resolves a runtime pick to its source id before calling in). A source id
// survives undo/redo recreates, where the runtime World id changes.

const DEFAULT_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { w: 1, x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

// True if walking up from `nodeSrc` reaches `ancestorSrc` — used to reject
// re-parenting an entity under one of its own descendants (a cycle). Reads the
// model hierarchy (the truth), not the World.
function isModelAncestor(nodeSrc: number, ancestorSrc: number): boolean {
  let cur: number | null = nodeSrc;
  const seen = new Set<number>();
  while (cur != null) {
    if (cur === ancestorSrc) return true;
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = SceneModel.entityBySource(cur)?.parent ?? null;
  }
  return false;
}

// — Field-edit gesture: coalesce a focus→blur / drag into a single undo step. —
//
// Undo recording is INTERNAL: the only public write door is `setField` (and
// `setEntityXY`, which routes through it), and it always records. Outside a
// gesture, one `setField` = one undo step. Inside a gesture, writes coalesce —
// the BEFORE model value is captured on first touch of each field, the AFTER
// value read at `endGesture`, and the pair recorded as one model-op step.

interface FieldEdit {
  sourceId: number;
  comp: string;
  key: string;
  before: unknown; // model (SceneData-format) value before the gesture
}

let gesture: { label: string; touched: Map<string, FieldEdit> } | null = null;

const editKey = (sourceId: number, comp: string, key: string) => `${sourceId}|${comp}|${key}`;

// Value equality over the SceneData-format shapes a field can hold (number /
// bool / string / vec / quat / color object). JSON compare is exact for these.
const valueEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The current model value of one field, or undefined. */
function modelFieldValue(sourceId: number, comp: string, key: string): unknown {
  const c = SceneModel.entityBySource(sourceId)?.components.find((c) => c.type === comp);
  return c ? (c.data as Record<string, unknown>)[key] : undefined;
}

/**
 * Convert an inspector control value to its SceneData-format model value,
 * merging into the current value where the control edits a slice (vec
 * components keep the untouched axis; color keeps alpha). 2D rotation is stored
 * as a quaternion; angle controls convert degrees↔quat.
 */
function toModelValue(
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

export const SceneCommands = {
  /**
   * Open a coalescing edit gesture. Every `setField` until {@link endGesture}
   * folds into one undo step. Idempotent-safe: a dangling gesture is committed
   * before a new one opens.
   */
  beginGesture(label: string): void {
    if (gesture) this.endGesture();
    gesture = { label, touched: new Map() };
  },

  /** Close the current gesture, recording all coalesced field edits as one undo step. */
  endGesture(): void {
    const g = gesture;
    gesture = null;
    if (!g || g.touched.size === 0) return;
    const edits = [...g.touched.values()]
      .map((e) => ({ ...e, after: structuredClone(modelFieldValue(e.sourceId, e.comp, e.key)) }))
      .filter((e) => !valueEqual(e.before, e.after));
    if (edits.length === 0) return;
    EditorHistory.record(
      g.label,
      () => edits.forEach((e) => SceneModel.setField(e.sourceId, e.comp, e.key, e.after)),
      () => edits.forEach((e) => SceneModel.setField(e.sourceId, e.comp, e.key, e.before)),
    );
  },

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
    const e = SceneModel.entityBySource(sourceId);
    if (!e) return;
    const cur = (e.components.find((c) => c.type === compName)?.data as Record<string, unknown>) ?? {};

    const k = editKey(sourceId, compName, key);
    const firstTouch = !gesture || !gesture.touched.has(k);
    const before = firstTouch ? structuredClone(cur[key]) : undefined;

    const after = toModelValue(cur, type, key, value);
    SceneModel.setField(sourceId, compName, key, after);

    if (gesture) {
      if (firstTouch) gesture.touched.set(k, { sourceId, comp: compName, key, before });
      return;
    }
    // No open gesture → this edit is its own undo step.
    if (valueEqual(before, after)) return;
    EditorHistory.record(
      `Edit ${prettyLabel(key)}`,
      () => SceneModel.setField(sourceId, compName, key, after),
      () => SceneModel.setField(sourceId, compName, key, before),
    );
  },

  /** Move an entity to a world position (keeps Z). Undoable like any field edit. */
  setEntityXY(sourceId: EntityId, x: number, y: number): void {
    const pos = modelFieldValue(sourceId, 'Transform', 'position') as { z?: number } | undefined;
    if (pos === undefined && !SceneModel.entityBySource(sourceId)) return;
    this.setField(sourceId, 'Transform', 'position', 'vec3', [x, y, pos?.z ?? 0]);
  },

  // — Undoable entity lifecycle (model ops; the Reconciler re-spawns/-despawns) —

  /** Spawn a new empty entity (with a Transform). Returns its source id. */
  addEntity(): EntityId | null {
    if (!SceneModel.current) return null;
    const sourceId = SceneModel.addEntity('Entity', [
      { type: 'Transform', data: structuredClone(DEFAULT_TRANSFORM) } as SceneComponent,
    ]);
    let record: SceneEntity | undefined;
    EditorHistory.record(
      'Add Entity',
      () => {
        if (record) SceneModel.restoreEntity(record);
      },
      () => {
        record = SceneModel.removeEntityBySource(sourceId);
      },
    );
    return sourceId;
  },

  /** Delete an entity (undo re-creates it, losslessly, from the model record). */
  deleteEntity(sourceId: EntityId): void {
    const name = SceneModel.entityBySource(sourceId)?.name || 'Entity';
    let record = SceneModel.removeEntityBySource(sourceId);
    if (!record) return;
    EditorHistory.record(
      `Delete ${name}`,
      () => {
        record = SceneModel.removeEntityBySource(record!.id) ?? record;
      },
      () => {
        SceneModel.restoreEntity(record!);
      },
    );
  },

  /** Duplicate an entity (offset slightly, as a sibling). Returns the new source id. */
  duplicateEntity(sourceId: EntityId): EntityId | null {
    const src = SceneModel.entityBySource(sourceId);
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
    const newSourceId = SceneModel.addEntity(src.name, components, src.parent ?? null);
    let record: SceneEntity | undefined;
    EditorHistory.record(
      `Duplicate ${src.name || 'Entity'}`,
      () => {
        if (record) SceneModel.restoreEntity(record);
      },
      () => {
        record = SceneModel.removeEntityBySource(newSourceId);
      },
    );
    return newSourceId;
  },

  /** Rename an entity (undoable). */
  renameEntity(sourceId: EntityId, name: string): void {
    const before = SceneModel.entityBySource(sourceId)?.name;
    if (before === undefined || before === name) return;
    SceneModel.setName(sourceId, name);
    EditorHistory.record(
      `Rename ${name || 'Entity'}`,
      () => SceneModel.setName(sourceId, name),
      () => SceneModel.setName(sourceId, before),
    );
  },

  /**
   * Re-parent an entity (drag-reparent). Undoable. Rejects self-parenting and
   * cycles (parenting under its own descendant); `parent: null` un-parents.
   */
  setParent(sourceId: EntityId, parent: EntityId | null): void {
    if (!SceneModel.entityBySource(sourceId)) return;
    if (parent != null && (parent === sourceId || isModelAncestor(parent, sourceId))) return;
    const before = SceneModel.entityBySource(sourceId)?.parent ?? null;
    if (before === parent) return;
    SceneModel.setParent(sourceId, parent);
    EditorHistory.record(
      'Reparent',
      () => SceneModel.setParent(sourceId, parent),
      () => SceneModel.setParent(sourceId, before),
    );
  },

  /** Add a component (with its registered/schema defaults) to an entity. Undoable. */
  addComponent(sourceId: EntityId, compName: string): void {
    const entity = SceneModel.entityBySource(sourceId);
    if (!entity || entity.components.some((c) => c.type === compName)) return;
    const def = componentByName(compName);
    // Builtins default from the engine registry; user/script components from the
    // schemas.json shape; an unknown-but-named component starts empty.
    const data = def
      ? structuredClone(componentDefaults(def))
      : structuredClone(userSchema(compName)?.default ?? {});
    SceneModel.setComponent(sourceId, compName, data);
    EditorHistory.record(
      `Add ${prettyLabel(compName)}`,
      () => SceneModel.setComponent(sourceId, compName, structuredClone(data)),
      () => SceneModel.removeComponent(sourceId, compName),
    );
  },

  /** Remove a component from an entity (Transform / Name are protected). Undoable. */
  removeComponent(sourceId: EntityId, compName: string): void {
    if (compName === 'Transform' || compName === 'Name') return;
    const comp = SceneModel.entityBySource(sourceId)?.components.find((c) => c.type === compName);
    if (!comp) return;
    const data = structuredClone(comp.data);
    SceneModel.removeComponent(sourceId, compName);
    EditorHistory.record(
      `Remove ${prettyLabel(compName)}`,
      () => SceneModel.removeComponent(sourceId, compName),
      () => SceneModel.setComponent(sourceId, compName, structuredClone(data)),
    );
  },

  /**
   * Toggle an entity's editor visibility by flipping the `enabled` field of each
   * of its components that has one (coalesced into one undo step). Lossless +
   * persisted; SceneQuery reflects it as the row's visibility.
   */
  setEntityVisible(sourceId: EntityId, visible: boolean): void {
    const entity = SceneModel.entityBySource(sourceId);
    if (!entity) return;
    this.beginGesture(visible ? 'Show' : 'Hide');
    for (const comp of entity.components) {
      const data = comp.data as Record<string, unknown>;
      if (data && typeof data === 'object' && 'enabled' in data) {
        this.setField(sourceId, comp.type, 'enabled', 'bool', visible);
      }
    }
    this.endGesture();
  },
};
