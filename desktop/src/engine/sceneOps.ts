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
import { SceneModel } from './SceneModel';
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
  /**
   * Writes that were accepted and will not survive — a field something else
   * owns. Present only when there are any.
   *
   * A write that silently does nothing is worse than one that fails: an agent
   * built a chess board out of forty UI nodes, set `Transform.position` on each,
   * and got an empty viewport with no error anywhere. The inspector already says
   * this on the entity card and the diagnostics sweep repeats it, but both are
   * places you have to go LOOK — the answer belongs in the reply to the call
   * that made the mistake.
   */
  warnings?: string[];
}

/**
 * Why a field write will not stick, or null when it will.
 *
 * A UINode's placement is the LAYOUT's output: the layout pass writes the
 * resolved box into `Transform.position` on every relayout, so an authored one
 * holds until the next UI change and then vanishes. Moving a UI element means
 * changing a layout INPUT — the anchor/offset in Absolute mode, or the flow it
 * sits in.
 */
function layoutOwnedWarning(entity: EntityId, component: string, key: string): string | null {
  if (component !== 'Transform' || !/^(position|rotation|scale)/.test(key)) return null;
  const e = SceneModel.entityBySource(entity);
  if (!e?.components.some((c) => c.type === 'UINode')) return null;
  return `entity ${entity}: Transform.${key.split('.')[0]} is owned by the UI layout and will be overwritten `
    + 'at the next relayout. Move a UI element with its layout INPUTS instead — set UINode.position to '
    + 'Absolute (1) and give UINode.left / UINode.top — or place game content in the world as a Sprite, '
    + 'where Transform.position is exactly how it is placed.';
}

/** The component types a template puts on the entity it creates. */
function rootComponentTypes(prefab: PrefabData): string[] {
  const root = prefab.entities.find((e) => e.prefabEntityId === prefab.rootEntityId) ?? prefab.entities[0];
  return (root?.components ?? []).map((c) => c.type);
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

  // Phase 1 (async, no mutation): resolve every template to its PrefabData, and
  // to the prefab ref that makes it an INSTANCE rather than a copy.
  const prefabs = new Map<string, PrefabData>();
  const links = new Map<string, string | undefined>();
  for (const op of ops) {
    if (op.op !== 'create' || !op.template || prefabs.has(op.template)) continue;
    const source = sourceById(op.template);
    if (!source?.build) throw new Error(`unknown entity template: ${op.template} (see listEntityTemplates)`);
    prefabs.set(op.template, await source.build({ parent: null }));
    links.set(op.template, source.linkPrefabRef?.({ parent: null }));
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

  const warnings: string[] = [];
  const setFields = (entity: EntityId, fields: Record<string, unknown>): void => {
    for (const [path, value] of Object.entries(fields)) {
      const { component, key } = splitFieldPath(path);
      // The declared inspector type wins inside setField; this argument is advisory.
      EditorControlSurface.setField(entity, component, key, 'string', value as never);
      const warning = layoutOwnedWarning(entity, component, key);
      if (warning && !warnings.includes(warning)) warnings.push(warning);
    }
  };

  // Phase 2 (sync): one undo step — a throw rolls the whole batch back, the
  // entities it had already spawned included.
  EditorControlSurface.atomic(label, () => {
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
            // A prefab template must arrive as an INSTANCE — the same thing the
            // Create menu makes. Without this ref the subtree is created as
            // ordinary entities: the tree looks right, the batch reports success,
            // and the scene silently holds a COPY. A driver porting twenty panels
            // through op programs got twenty copies and no way to notice, while
            // the identical template through `create_entity` linked correctly.
            const id = EditorControlSurface.create(prefab, {
              parent, position,
              linkPrefabRef: op.template ? links.get(op.template) : undefined,
              // Named as it is built rather than renamed after — on a prefab
              // template that is the difference between one described change and
              // two, and the tree never shows the prefab's own name in between.
              name: op.name,
            });
            if (id == null) throw new Error('entity creation returned no id');
            created.push(id);
            if (op.ref) refs[op.ref] = id;
            if (op.fields) {
              // `components` REPLACES the default `['Transform']` rather than
              // adding to it, so a create that names ShapeRenderer and then
              // writes `Transform.position.y` fails with "component Transform is
              // not on entity 3" — true, and no help at all when the same op
              // supports `x`/`y`, which quietly supply the Transform this one
              // just dropped. Say which side of that the caller landed on.
              //
              // A TEMPLATE brings its own components, so it is asked what they
              // are: `specs` is not about it, and its default would refuse
              // `{template: 'ui-text', fields: {'Text.content': …}}`.
              const declared = new Set(
                op.template
                  ? rootComponentTypes(prefab)
                  : specs.map((c) => (typeof c === 'string' ? c : c.type)),
              );
              const missing = [...new Set(Object.keys(op.fields).map((k) => k.split('.')[0]))]
                .filter((c) => !declared.has(c));
              if (missing.length > 0) {
                throw new Error(
                  op.template
                    ? `fields write to ${missing.map((c) => `"${c}"`).join(', ')}, which the template `
                      + `"${op.template}" does not put on its root (it has `
                      + `${[...declared].map((c) => `"${c}"`).join(', ')}). Add the component in a later op, `
                      + 'or build the entity from `components` instead of a template.'
                    : `fields write to ${missing.map((c) => `"${c}"`).join(', ')}, which this create does `
                      + `not declare (it declares ${[...declared].map((c) => `"${c}"`).join(', ')}). Naming any `
                      + '`components` replaces the default ["Transform"] — list every component your fields '
                      + `write to${missing.includes('Transform') ? ', or give x/y instead of Transform.position' : ''}.`,
                );
              }
              setFields(id, op.fields);
            }
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

  return { refs, created, applied: ops.length, ...(warnings.length ? { warnings } : {}) };
}
