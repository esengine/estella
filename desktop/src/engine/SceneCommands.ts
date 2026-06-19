import { Transform, Name, getAllRegisteredComponents } from 'esengine';
import type { EntityId, InspectorFieldType, InspectorFieldValue } from '@/types';
import { EngineHost } from './EngineHost';
import { EditorHistory } from './EditorHistory';
import { EntityHandles } from './EntityHandles';
import { SceneQuery } from './SceneQuery';
import { componentByName, angleZToQuat, hexToRgb, prettyLabel, type WorldT } from './schema';

// — Entity snapshot capture/restore for undoable create/delete —
// Parent/Children carry entity-id references that go stale on re-create, so
// hierarchy links aren't restored here (flat re-spawn). Refinement: remap ids.
const STRUCTURAL_SKIP = new Set(['Parent', 'Children']);

interface CapturedEntity {
  name: string;
  comps: Array<{ name: string; data: unknown }>;
}

function captureEntity(world: WorldT, id: EntityId): CapturedEntity | null {
  if (!world.valid(id)) return null;
  let name = '';
  const comps: Array<{ name: string; data: unknown }> = [];
  for (const [compName, def] of getAllRegisteredComponents()) {
    if (STRUCTURAL_SKIP.has(compName) || !world.has(id, def)) continue;
    const data = structuredClone(world.get(id, def));
    if (compName === 'Name') name = (data as { value?: string }).value ?? '';
    comps.push({ name: compName, data });
  }
  return { name, comps };
}

function recreateEntity(world: WorldT, cap: CapturedEntity): EntityId {
  const e = world.spawn();
  for (const c of cap.comps) {
    const def = componentByName(c.name);
    if (def) world.insert(e, def, c.data as never);
  }
  return e;
}

const DEFAULT_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { w: 1, x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

// — Field-edit gesture: coalesce a focus→blur / drag into a single undo step. —
//
// Undo recording is INTERNAL to this module: the only public write door is
// `setField` (and `setEntityXY`, which routes through it), and it always
// records. The raw, non-recording writer `applyFieldWrite` is module-private,
// so no caller can mutate a field while skipping undo. Outside a gesture, one
// `setField` = one undo step. Inside a gesture, writes coalesce — the BEFORE
// value is captured on first touch of each field, the AFTER value read at
// `endGesture`, and the pair recorded as one step.

interface FieldEdit {
  entity: EntityId;
  comp: string;
  key: string;
  type: InspectorFieldType;
  before: InspectorFieldValue;
}

let gesture: { label: string; touched: Map<string, FieldEdit> } | null = null;

const editKey = (entity: EntityId, comp: string, key: string) => `${entity}|${comp}|${key}`;

function fieldEqual(a: InspectorFieldValue, b: InspectorFieldValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

// Raw write straight through to the engine World — NO undo recording, NOT
// exported. Besides `setField`, the only callers are the undo/redo closures
// (which must re-apply without re-recording).
function applyFieldWrite(
  entity: EntityId,
  compName: string,
  key: string,
  type: InspectorFieldType,
  value: InspectorFieldValue,
): void {
  const world = EngineHost.app?.world;
  if (!world || !world.valid(entity)) return;
  const def = componentByName(compName);
  if (!def) return;

  const cur = world.get(entity, def) as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = { ...cur };

  switch (type) {
    case 'number':
      next[key] = Number(value);
      break;
    case 'bool':
      next[key] = Boolean(value);
      break;
    case 'string':
      next[key] = String(value);
      break;
    case 'vec2': {
      const [x, y] = value as [number, number];
      next[key] = { ...(cur[key] as object), x, y };
      break;
    }
    case 'vec3': {
      const [x, y, z] = value as [number, number, number];
      next[key] = { ...(cur[key] as object), x, y, z };
      break;
    }
    case 'angle':
      next[key] = angleZToQuat(Number(value));
      break;
    case 'color': {
      const a = (cur[key] as { a?: number } | undefined)?.a ?? 1;
      next[key] = { ...(cur[key] as object), ...hexToRgb(String(value)), a };
      break;
    }
  }

  world.set(entity, def, next as unknown as Parameters<WorldT['set']>[2]);
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
      .map((e) => ({ ...e, after: SceneQuery.getFieldValue(e.entity, e.comp, e.key) }))
      .filter((e) => e.after != null && !fieldEqual(e.before, e.after as InspectorFieldValue));
    if (edits.length === 0) return;
    EditorHistory.record(
      g.label,
      () =>
        edits.forEach((e) =>
          applyFieldWrite(e.entity, e.comp, e.key, e.type, e.after as InspectorFieldValue),
        ),
      () => edits.forEach((e) => applyFieldWrite(e.entity, e.comp, e.key, e.type, e.before)),
    );
  },

  /**
   * Write a single inspector field back to the engine (re-renders next frame).
   * Always undoable: coalesced into an open gesture, else recorded as its own step.
   */
  setField(
    entity: EntityId,
    compName: string,
    key: string,
    type: InspectorFieldType,
    value: InspectorFieldValue,
  ): void {
    const world = EngineHost.app?.world;
    if (!world || !world.valid(entity) || !componentByName(compName)) return;

    const k = editKey(entity, compName, key);
    const firstTouch = !gesture || !gesture.touched.has(k);
    const before = firstTouch ? SceneQuery.getFieldValue(entity, compName, key) : null;

    applyFieldWrite(entity, compName, key, type, value);

    if (gesture) {
      if (firstTouch && before != null) {
        gesture.touched.set(k, { entity, comp: compName, key, type, before });
      }
      return;
    }
    // No open gesture → this edit is its own undo step.
    if (before == null) return;
    const after = SceneQuery.getFieldValue(entity, compName, key);
    if (after == null || fieldEqual(before, after)) return;
    EditorHistory.record(
      `Edit ${prettyLabel(key)}`,
      () => applyFieldWrite(entity, compName, key, type, after),
      () => applyFieldWrite(entity, compName, key, type, before),
    );
  },

  /** Move an entity to a world position (keeps Z). Undoable like any field edit. */
  setEntityXY(id: EntityId, x: number, y: number): void {
    const world = EngineHost.app?.world;
    if (!world || !world.valid(id) || !world.has(id, Transform)) return;
    const z = world.get(id, Transform).position.z;
    this.setField(id, 'Transform', 'position', 'vec3', [x, y, z]);
  },

  // — Undoable entity lifecycle. Re-creating an entity changes its engine id,
  //   so closures track a stable EntityHandle and resolve it live. —

  /** Spawn a new empty entity (with a Transform). Returns its id. */
  addEntity(): EntityId | null {
    const world = EngineHost.app?.world;
    if (!world) return null;
    const e = world.spawn('Entity');
    world.insert(e, Transform, DEFAULT_TRANSFORM);
    const cap = captureEntity(world, e);
    const handle = EntityHandles.acquire(e);
    EditorHistory.record(
      'Add Entity',
      () => {
        if (cap) EntityHandles.rebind(handle, recreateEntity(world, cap));
      },
      () => despawnHandle(world, handle),
    );
    return e;
  },

  /** Delete an entity (undo re-creates it under the same stable handle). */
  deleteEntity(id: EntityId): void {
    const world = EngineHost.app?.world;
    if (!world || !world.valid(id)) return;
    const cap = captureEntity(world, id);
    if (!cap) return;
    const handle = EntityHandles.acquire(id);
    world.despawn(id);
    EntityHandles.rebind(handle, null);
    EditorHistory.record(
      `Delete ${cap.name || 'Entity'}`,
      () => despawnHandle(world, handle),
      () => EntityHandles.rebind(handle, recreateEntity(world, cap)),
    );
  },

  /** Duplicate an entity (offset slightly). Returns the new id. */
  duplicateEntity(id: EntityId): EntityId | null {
    const world = EngineHost.app?.world;
    if (!world || !world.valid(id)) return null;
    const cap = captureEntity(world, id);
    if (!cap) return null;
    const t = cap.comps.find((c) => c.name === 'Transform');
    const pos = t && (t.data as { position?: { x: number; y: number } }).position;
    if (pos) {
      pos.x += 24;
      pos.y -= 24;
    }
    const dup = recreateEntity(world, cap);
    const handle = EntityHandles.acquire(dup);
    EditorHistory.record(
      `Duplicate ${cap.name || 'Entity'}`,
      () => EntityHandles.rebind(handle, recreateEntity(world, cap)),
      () => despawnHandle(world, handle),
    );
    return dup;
  },

  /** Rename an entity via its Name component (undoable). */
  renameEntity(id: EntityId, name: string): void {
    const world = EngineHost.app?.world;
    if (!world || !world.valid(id)) return;
    const before = world.has(id, Name) ? world.get(id, Name).value : '';
    if (before === name) return;
    const handle = EntityHandles.acquire(id);
    const setName = (value: string) => {
      const live = EntityHandles.liveId(handle);
      if (live != null && world.valid(live)) world.insert(live, Name, { value });
    };
    setName(name);
    EditorHistory.record(`Rename ${name || 'Entity'}`, () => setName(name), () => setName(before));
  },
};

// Despawn the entity a handle currently points at (no-op if already deleted).
function despawnHandle(world: WorldT, handle: number): void {
  const id = EntityHandles.liveId(handle);
  if (id != null && world.valid(id)) world.despawn(id);
  EntityHandles.rebind(handle, null);
}
