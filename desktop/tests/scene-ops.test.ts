// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Regression net for applySceneOps — the batched scene-authoring door.
 *
 * sceneOps adds no editing truth: it is an interpreter that turns an op program
 * into calls on EditorControlSurface, inside one transaction. So the unit under
 * test is exactly that translation — ref addressing, "Component.key" splitting,
 * op ordering, and the failure contract (locate the op, roll the batch back).
 * The surface is a recording fake; the real one is covered by its own suite.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<[string, ...unknown[]]>);
const state = vi.hoisted(() => ({ nextId: 100, createReturnsNull: false, throwOnField: '' }));

vi.mock('@/engine/EditorSession', () => ({
  EditorControlSurface: {
    // The real one rolls structural edits back too (SceneCommands.atomic); this
    // fake only records the boundary, which is all the interpreter can be asked
    // about. That the rollback HAPPENS is pinned in editor-history-group.test.ts
    // against the real history — a fake that simply rethrows once made this
    // suite report a rollback contract nothing was keeping.
    atomic: (label: string, fn: () => void) => {
      calls.push(['transact:begin', label]);
      try {
        fn();
      } catch (e) {
        calls.push(['transact:abort']);
        throw e;
      }
      calls.push(['transact:commit']);
    },
    create: (prefab: { name: string }, opts: { parent: number | null }) => {
      calls.push(['create', prefab.name, opts.parent]);
      return state.createReturnsNull ? null : state.nextId++;
    },
    setField: (entity: number, component: string, key: string, _t: string, value: unknown) => {
      if (state.throwOnField === `${component}.${key}`) throw new Error(`no field "${key}"`);
      calls.push(['setField', entity, component, key, value]);
    },
    renameEntity: (id: number, name: string) => calls.push(['rename', id, name]),
    addComponent: (id: number, c: string) => calls.push(['addComponent', id, c]),
    removeComponent: (id: number, c: string) => calls.push(['removeComponent', id, c]),
    setParent: (id: number, p: number | null) => calls.push(['setParent', id, p]),
    deleteEntity: (id: number) => calls.push(['delete', id]),
  },
}));

vi.mock('@/engine/entitySources', () => ({
  prefabFromSpecs: (name: string, specs: { type: string }[]) => ({ name, specs }),
  sourceById: (id: string) =>
    id === 'ui-image' ? { build: async () => ({ name: 'Image', specs: [] }) } : null,
}));

const { applySceneOps } = await import('@/engine/sceneOps');

beforeEach(() => {
  calls.length = 0;
  state.nextId = 100;
  state.createReturnsNull = false;
  state.throwOnField = '';
});

describe('applySceneOps', () => {
  it('runs the whole program inside ONE transaction', async () => {
    await applySceneOps([{ op: 'create' }, { op: 'create' }], 'Build panel');
    expect(calls[0]).toEqual(['transact:begin', 'Build panel']);
    expect(calls.at(-1)).toEqual(['transact:commit']);
    expect(calls.filter((c) => c[0] === 'transact:begin')).toHaveLength(1);
  });

  it('binds created entities to refs and resolves "$ref" as a parent', async () => {
    const res = await applySceneOps([
      { op: 'create', ref: 'root', name: 'Panel' },
      { op: 'create', ref: 'child', name: 'Label', parent: '$root' },
    ]);
    expect(res.refs).toEqual({ root: 100, child: 101 });
    expect(res.created).toEqual([100, 101]);
    expect(res.applied).toBe(2);
    expect(calls).toContainEqual(['create', 'Label', 100]);
  });

  it('accepts a live numeric id anywhere a ref is accepted', async () => {
    await applySceneOps([{ op: 'set', entity: 7, fields: { 'Text.content': 'hi' } }]);
    expect(calls).toContainEqual(['setField', 7, 'Text', 'content', 'hi']);
  });

  it('splits "Component.key" on the FIRST dot so nested keys survive', async () => {
    await applySceneOps([
      { op: 'set', entity: 1, fields: { 'Transform.position.x': 10, 'UIVisual.color': '#ff0000ff' } },
    ]);
    expect(calls).toContainEqual(['setField', 1, 'Transform', 'position.x', 10]);
    expect(calls).toContainEqual(['setField', 1, 'UIVisual', 'color', '#ff0000ff']);
  });

  it('rejects a field path that is not "Component.key"', async () => {
    await expect(applySceneOps([{ op: 'set', entity: 1, fields: { content: 'hi' } }]))
      .rejects.toThrow(/must be "Component.key"/);
  });

  it('builds from an explicit component list, defaulting to Transform', async () => {
    await applySceneOps([
      { op: 'create', name: 'Node', components: ['Transform', 'UINode', { type: 'UIVisual', data: { enabled: true } }] },
      { op: 'create', name: 'Bare' },
    ]);
    expect(calls).toContainEqual(['create', 'Node', null]);
    expect(calls).toContainEqual(['create', 'Bare', null]);
  });

  it('resolves an entity template before mutating, and rejects an unknown one', async () => {
    await applySceneOps([{ op: 'create', ref: 'img', template: 'ui-image', name: 'Icon' }]);
    expect(calls).toContainEqual(['create', 'Image', null]);
    expect(calls).toContainEqual(['rename', 100, 'Icon']);

    calls.length = 0;
    await expect(applySceneOps([{ op: 'create', template: 'nope' }])).rejects.toThrow(/unknown entity template/);
    // Rejected during the async resolve phase — nothing was mutated.
    expect(calls).toHaveLength(0);
  });

  it('applies create-time fields to the entity it just made', async () => {
    await applySceneOps([{ op: 'create', ref: 'n', fields: { 'Text.content': 'Alice' } }]);
    expect(calls).toContainEqual(['setField', 100, 'Text', 'content', 'Alice']);
  });

  it('dispatches the non-create ops to their surface doors', async () => {
    await applySceneOps([
      { op: 'add_component', entity: 5, component: 'UIVisual' },
      { op: 'remove_component', entity: 5, component: 'Sprite' },
      { op: 'rename', entity: 5, name: 'Renamed' },
      { op: 'parent', entity: 5, parent: null },
      { op: 'delete', entity: 5 },
    ]);
    expect(calls).toContainEqual(['addComponent', 5, 'UIVisual']);
    expect(calls).toContainEqual(['removeComponent', 5, 'Sprite']);
    expect(calls).toContainEqual(['rename', 5, 'Renamed']);
    expect(calls).toContainEqual(['setParent', 5, null]);
    expect(calls).toContainEqual(['delete', 5]);
  });

  it('locates the failing op and aborts the transaction (no half-built subtree)', async () => {
    state.throwOnField = 'Text.bogus';
    await expect(applySceneOps([
      { op: 'create', ref: 'a' },
      { op: 'set', entity: '$a', fields: { 'Text.bogus': 1 } },
    ])).rejects.toThrow(/op\[1\] set: no field "bogus"/);
    expect(calls).toContainEqual(['transact:abort']);
    expect(calls).not.toContainEqual(['transact:commit']);
  });

  it('names the unknown ref and what was defined so far', async () => {
    await expect(applySceneOps([
      { op: 'create', ref: 'a' },
      { op: 'create', parent: '$missing' },
    ])).rejects.toThrow(/unknown ref "\$missing" \(defined so far: a\)/);
  });

  it('fails loudly when entity creation returns no id', async () => {
    state.createReturnsNull = true;
    await expect(applySceneOps([{ op: 'create' }])).rejects.toThrow(/op\[0\] create: entity creation returned no id/);
  });

  it('rejects an unknown op name', async () => {
    await expect(applySceneOps([{ op: 'frobnicate' } as never])).rejects.toThrow(/unknown op "frobnicate"/);
  });

  it('rejects a non-array program', async () => {
    await expect(applySceneOps('nope' as never)).rejects.toThrow(/must be an array/);
  });
});
