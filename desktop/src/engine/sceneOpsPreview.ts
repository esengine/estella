// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sceneOpsPreview.ts — what a batch of scene ops WOULD do, before it does it.
 *
 * The change set the drawer already shows is read from EditorHistory, so it can
 * only answer after the fact: you see what happened, and your recourse is to
 * revert the whole run. This answers the same question in the other direction —
 * what is about to happen, while saying no is still free.
 *
 * Derived rather than rehearsed. A dry run would mean executing the batch
 * against a scratch copy of the scene and diffing it, which is both expensive
 * and a second implementation of applySceneOps to keep in step. The ops are
 * already declarative — each one names what it does and to what — so the
 * preview is a fold over the program plus ONE read of the scene for the values
 * being replaced. Nothing is mutated, and nothing has to be undone if the
 * person says no.
 *
 * What it cannot know, it does not claim: a `template` expands to components
 * this module does not resolve (that needs the async source build), and an
 * entity created by an earlier op has no name in the scene yet. Both are
 * reported as what the op SAYS, which is what the person is being asked about.
 */
import type { EntityId } from '@/types';
import type { SceneOp, EntityRef } from './sceneOps';

export type PreviewKind = 'add' | 'modify' | 'remove';

/** One field a `set` (or a `create`'s `fields`) would write. */
export interface PreviewField {
  /** `"Transform.position.x"`, as written. */
  path: string;
  /** What the scene holds now — absent for an entity this batch is creating. */
  before?: unknown;
  after: unknown;
}

/** One line of the preview: an op, said in the scene's terms rather than the program's. */
export interface PreviewEntry {
  /** Index in the original program — what a caller drops to decline this line. */
  index: number;
  kind: PreviewKind;
  /** The op's verb, for the row's label. */
  op: SceneOp['op'];
  /** The entity as the person would name it: its scene name, or the op's `ref`. */
  target: string;
  /** Resolved id, when the op addresses one that already exists. */
  entity: EntityId | null;
  /** Components being added (create/add_component) or removed. */
  components?: string[];
  fields?: PreviewField[];
  /** For `parent` / `rename`: what it becomes. */
  detail?: string;
  /** Ops that cannot run without this one — declining it declines them too. */
  dependents?: number[];
}

/** What the preview needs from the editor: names and current values, nothing else. */
export interface PreviewScene {
  entityName(id: EntityId): string | null;
  fieldValue(id: EntityId, component: string, key: string): unknown;
}

const KIND: Record<SceneOp['op'], PreviewKind> = {
  create: 'add',
  set: 'modify',
  add_component: 'modify',
  remove_component: 'modify',
  rename: 'modify',
  parent: 'modify',
  delete: 'remove',
};

/** Split `"Component.key"` the way sceneOps does — only the FIRST dot separates. */
function splitPath(path: string): { component: string; key: string } | null {
  const dot = path.indexOf('.');
  if (dot <= 0 || dot === path.length - 1) return null;
  return { component: path.slice(0, dot), key: path.slice(dot + 1) };
}

const refName = (ref: EntityRef): string =>
  (typeof ref === 'string' && ref.startsWith('$') ? ref.slice(1) : String(ref));

/**
 * Read `ops` as the list of changes it would make.
 *
 * `scene` is consulted only for entities that already exist: their name, and the
 * value a write would replace. An op addressing `"$ref"` refers to something
 * this batch creates, which has neither yet.
 */
export function previewSceneOps(ops: readonly SceneOp[], scene: PreviewScene): PreviewEntry[] {
  // ref → the op that creates it, so a declined create can take its dependents.
  const createdBy = new Map<string, number>();
  ops.forEach((op, i) => {
    if (op.op === 'create' && op.ref) createdBy.set(op.ref, i);
  });

  const dependents = new Map<number, number[]>();
  const noteDependency = (ref: EntityRef | null | undefined, from: number): void => {
    if (typeof ref !== 'string') return;
    const owner = createdBy.get(refName(ref));
    if (owner === undefined || owner === from) return;
    const list = dependents.get(owner) ?? [];
    list.push(from);
    dependents.set(owner, list);
  };

  /** A live id, or null when the op names something this batch has yet to create. */
  const liveId = (ref: EntityRef | null | undefined): EntityId | null =>
    (typeof ref === 'number' ? (ref as EntityId) : null);

  const describe = (ref: EntityRef | null | undefined): string => {
    if (ref == null) return '(root)';
    const id = liveId(ref);
    if (id === null) return refName(ref);
    return scene.entityName(id) ?? `#${id}`;
  };

  const entries: PreviewEntry[] = ops.map((op, index) => {
    const base = { index, kind: KIND[op.op], op: op.op };

    if (op.op === 'create') {
      noteDependency(op.parent, index);
      const fields = Object.entries(op.fields ?? {}).map(([path, after]) => ({ path, after }));
      return {
        ...base,
        target: op.name ?? op.ref ?? '(unnamed)',
        entity: null,
        components: op.template
          ? [op.template]
          : (op.components ?? []).map((c) => (typeof c === 'string' ? c : c.type)),
        ...(fields.length ? { fields } : {}),
        ...(op.parent != null ? { detail: `under ${describe(op.parent)}` } : {}),
      };
    }

    noteDependency(op.entity, index);
    const id = liveId(op.entity);
    const target = describe(op.entity);

    switch (op.op) {
      case 'set': {
        const fields = Object.entries(op.fields).map(([path, after]) => {
          const split = id !== null ? splitPath(path) : null;
          const before = split ? scene.fieldValue(id!, split.component, split.key) : undefined;
          return before === undefined ? { path, after } : { path, before, after };
        });
        return { ...base, target, entity: id, fields };
      }
      case 'add_component':
      case 'remove_component':
        return { ...base, target, entity: id, components: [op.component] };
      case 'rename':
        return { ...base, target, entity: id, detail: op.name };
      case 'parent': {
        noteDependency(op.parent, index);
        return { ...base, target, entity: id, detail: `under ${describe(op.parent)}` };
      }
      default:
        return { ...base, target, entity: id };
    }
  });

  for (const [owner, list] of dependents) entries[owner].dependents = list;
  return entries;
}

/**
 * The batch with `declined` (and everything that depends on it) removed.
 *
 * Dependents travel with their create because the program addresses them by
 * `"$ref"`: running a `set` whose entity was never created is not a smaller
 * change, it is a throw that rolls the rest back.
 */
export function withoutDeclined(
  ops: readonly SceneOp[],
  declined: ReadonlySet<number>,
): { ops: SceneOp[]; dropped: number[] } {
  const preview = previewSceneOps(ops, { entityName: () => null, fieldValue: () => undefined });
  const drop = new Set(declined);
  // A dependent can itself create a ref others depend on, so keep going until
  // the set stops growing rather than assuming one level.
  for (let grew = true; grew;) {
    grew = false;
    for (const entry of preview) {
      if (!drop.has(entry.index)) continue;
      for (const dep of entry.dependents ?? []) {
        if (!drop.has(dep)) { drop.add(dep); grew = true; }
      }
    }
  }
  return {
    ops: ops.filter((_, i) => !drop.has(i)),
    dropped: [...drop].sort((a, b) => a - b),
  };
}
