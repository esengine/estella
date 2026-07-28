// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sceneOps.ts — batched scene authoring: many edits, one transaction.
 *
 * The per-field write door (EditorControlSurface.setField) is shaped for the UI,
 * where a human changes one value at a time. Authoring a SCENE that way — a UI
 * panel is easily a hundred nodes with a dozen fields each — costs thousands of
 * round trips through the automation boundary, and litters the undo stack with
 * one step per field.
 *
 * `applySceneOps` takes a program instead: a list of ops that create entities,
 * parent them, add components and set fields, executed as ONE undoable step.
 * Ops name entities they create with a `ref`, and later ops address them as
 * `"$ref"` — so a whole subtree is expressible in a single call without the
 * caller round-tripping to learn each new id.
 *
 * It adds no editing truth of its own: every mutation goes through the same
 * EditorControlSurface doors the UI uses (so validation, coercion and the
 * reconciler behave identically), and the whole program runs inside one
 * `transact` — a throw anywhere rolls the entire batch back rather than leaving
 * a half-built subtree behind.
 */
import type { EntityId } from '@/types';
import type { PrefabData } from 'esengine';
import { EditorControlSurface } from './EditorSession';
import { prefabFromSpecs, sourceById } from './entitySources';

/** An entity address: a live id, or `"$ref"` naming an entity an earlier op created. */
export type EntityRef = number | string;

/** A component to seed a created entity with: `"UINode"` or `{ type, data }`. */
export type ComponentSpec = string | { type: string; data?: Record<string, unknown> };

export type SceneOp =
  | {
    op: 'create';
    /** Name this entity so later ops can address it as `"$<ref>"`. */
    ref?: string;
    name?: string;
    parent?: EntityRef | null;
    /** An entity-template id (see listEntityTemplates), e.g. `ui-image`. */
    template?: string;
    /** Explicit component list — the alternative to `template`. */
    components?: ComponentSpec[];
    /** Field writes applied to the new entity, as in the `set` op. */
    fields?: Record<string, unknown>;
    x?: number;
    y?: number;
  }
  | { op: 'set'; entity: EntityRef; fields: Record<string, unknown> }
  | { op: 'add_component'; entity: EntityRef; component: string }
  | { op: 'remove_component'; entity: EntityRef; component: string }
  | { op: 'rename'; entity: EntityRef; name: string }
  | { op: 'parent'; entity: EntityRef; parent: EntityRef | null }
  | { op: 'delete'; entity: EntityRef };

export interface SceneOpsResult {
  /** ref name → the entity id it was bound to. */
  refs: Record<string, EntityId>;
  /** Ids created by this batch, in creation order. */
  created: EntityId[];
  /** How many ops ran. */
  applied: number;
}

/**
 * Split a `"Component.key"` field path. Component names never contain a dot, but
 * keys do (`Transform.position.x`), so only the FIRST dot separates them.
 */
function splitFieldPath(path: string): { component: string; key: string } {
  const dot = path.indexOf('.');
  if (dot <= 0 || dot === path.length - 1) {
    throw new Error(`field "${path}" must be "Component.key" (e.g. "Transform.position.x")`);
  }
  return { component: path.slice(0, dot), key: path.slice(dot + 1) };
}

/**
 * Run `ops` as one undoable batch and return the ref bindings.
 *
 * Template lookups happen BEFORE the transaction because a template's `build`
 * may be async (prefab-backed widgets load their asset), while a transaction is
 * synchronous — resolving them up front keeps the mutation phase atomic.
 */
export async function applySceneOps(
  ops: readonly SceneOp[],
  label = 'Apply scene ops',
): Promise<SceneOpsResult> {
  if (!Array.isArray(ops)) throw new Error('applySceneOps: `ops` must be an array');

  // Phase 1 (async, no mutation): resolve every template to its PrefabData.
  const prefabs = new Map<string, PrefabData>();
  for (const op of ops) {
    if (op.op !== 'create' || !op.template || prefabs.has(op.template)) continue;
    const source = sourceById(op.template);
    if (!source?.build) throw new Error(`unknown entity template: ${op.template} (see listEntityTemplates)`);
    prefabs.set(op.template, await source.build({ parent: null }));
  }

  const refs: Record<string, EntityId> = {};
  const created: EntityId[] = [];

  const resolve = (ref: EntityRef | null | undefined, what: string): EntityId | null => {
    if (ref == null) return null;
    if (typeof ref === 'number') return ref as EntityId;
    const name = ref.startsWith('$') ? ref.slice(1) : ref;
    const id = refs[name];
    if (id == null) throw new Error(`${what} refers to unknown ref "${ref}" (defined so far: ${Object.keys(refs).join(', ') || 'none'})`);
    return id;
  };

  const setFields = (entity: EntityId, fields: Record<string, unknown>): void => {
    for (const [path, value] of Object.entries(fields)) {
      const { component, key } = splitFieldPath(path);
      // The declared inspector type wins inside setField; this argument is advisory.
      EditorControlSurface.setField(entity, component, key, 'string', value as never);
    }
  };

  // Phase 2 (sync): one transaction — a throw rolls the whole batch back.
  EditorControlSurface.transact(label, () => {
    ops.forEach((op, i) => {
      const at = `op[${i}] ${op.op}`;
      try {
        switch (op.op) {
          case 'create': {
            const parent = resolve(op.parent, at);
            const specs: ComponentSpec[] = op.components ?? ['Transform'];
            const prefab = op.template
              ? prefabs.get(op.template)!
              : prefabFromSpecs(
                op.name ?? 'Entity',
                specs.map((c) => (typeof c === 'string' ? { type: c } : c)),
              );
            const position = op.x != null && op.y != null ? { x: op.x, y: op.y } : undefined;
            const id = EditorControlSurface.create(prefab, { parent, position });
            if (id == null) throw new Error('entity creation returned no id');
            created.push(id);
            if (op.ref) refs[op.ref] = id;
            if (op.name) EditorControlSurface.renameEntity(id, op.name);
            if (op.fields) setFields(id, op.fields);
            break;
          }
          case 'set':
            setFields(resolve(op.entity, at)!, op.fields);
            break;
          case 'add_component':
            EditorControlSurface.addComponent(resolve(op.entity, at)!, op.component);
            break;
          case 'remove_component':
            EditorControlSurface.removeComponent(resolve(op.entity, at)!, op.component);
            break;
          case 'rename':
            EditorControlSurface.renameEntity(resolve(op.entity, at)!, op.name);
            break;
          case 'parent':
            EditorControlSurface.setParent(resolve(op.entity, at)!, resolve(op.parent, at));
            break;
          case 'delete':
            EditorControlSurface.deleteEntity(resolve(op.entity, at)!);
            break;
          default:
            throw new Error(`unknown op "${(op as { op: string }).op}"`);
        }
      } catch (e) {
        // Locate the failure for the caller: a 400-op program otherwise reports
        // only "component X is not on entity 12" with no clue which op wrote it.
        throw new Error(`${at}: ${(e as Error)?.message ?? String(e)}`);
      }
    });
  });

  return { refs, created, applied: ops.length };
}
