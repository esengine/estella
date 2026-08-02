// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a batch of scene ops would do, read before it does it.
 *
 *        Derived from the program rather than rehearsed against a scratch scene:
 *        the ops are declarative, so the preview is a fold over them plus one
 *        read for the values being replaced. These pin the two things that makes
 *        non-obvious — that an op naming `"$ref"` refers to something not in the
 *        scene yet, and that declining a create has to take its dependents.
 */
import { describe, it, expect } from 'vitest';
import { previewSceneOps, withoutDeclined, type PreviewScene } from '@/engine/sceneOpsPreview';
import type { SceneOp } from '@/engine/sceneOps';

/** A scene with two entities and one readable field. */
const scene: PreviewScene = {
  entityName: (id) => ({ 1: 'Panel', 2: 'Label' } as Record<number, string>)[id] ?? null,
  fieldValue: (id, component, key) =>
    (id === 1 && component === 'Transform' && key === 'position.x' ? 10 : undefined),
};

describe('previewing a batch of scene ops', () => {
  it('names a create by what the op calls it, and lists what it seeds', () => {
    const ops: SceneOp[] = [
      { op: 'create', ref: 'root', name: 'PauseRoot', components: ['Transform', 'UINode'] },
    ];
    expect(previewSceneOps(ops, scene)[0]).toMatchObject({
      kind: 'add', op: 'create', target: 'PauseRoot', entity: null,
      components: ['Transform', 'UINode'],
    });
  });

  // The whole reason this beats reading the raw program: an id means nothing to
  // the person, and the scene knows what it is called.
  it('names an existing entity the way the scene does', () => {
    const ops: SceneOp[] = [{ op: 'rename', entity: 1, name: 'Backdrop' }];
    expect(previewSceneOps(ops, scene)[0]).toMatchObject({
      kind: 'modify', target: 'Panel', entity: 1, detail: 'Backdrop',
    });
  });

  it('reads the value a write would replace', () => {
    const ops: SceneOp[] = [
      { op: 'set', entity: 1, fields: { 'Transform.position.x': 42, 'Text.content': 'hi' } },
    ];
    const [entry] = previewSceneOps(ops, scene);
    // Known field: before and after. Unknown one: only what it becomes — claiming
    // a `before` the scene did not give would be inventing it.
    expect(entry.fields).toEqual([
      { path: 'Transform.position.x', before: 10, after: 42 },
      { path: 'Text.content', after: 'hi' },
    ]);
  });

  // An entity this batch creates has no name and no values yet, and saying so is
  // more honest than showing "#undefined" or a stale reading.
  it('claims no before-value for something the batch has yet to create', () => {
    const ops: SceneOp[] = [
      { op: 'create', ref: 'panel', name: 'Panel2' },
      { op: 'set', entity: '$panel', fields: { 'UIVisual.color': '#fff' } },
    ];
    const [, set] = previewSceneOps(ops, scene);
    expect(set).toMatchObject({ target: 'panel', entity: null });
    expect(set.fields).toEqual([{ path: 'UIVisual.color', after: '#fff' }]);
  });

  it('records which ops a create is holding up', () => {
    const ops: SceneOp[] = [
      { op: 'create', ref: 'root', name: 'Root' },
      { op: 'create', ref: 'child', name: 'Child', parent: '$root' },
      { op: 'set', entity: '$root', fields: { 'Transform.position.y': 1 } },
    ];
    expect(previewSceneOps(ops, scene)[0].dependents).toEqual([1, 2]);
  });
});

describe('declining part of a batch', () => {
  const ops: SceneOp[] = [
    { op: 'create', ref: 'root', name: 'Root' },
    { op: 'create', ref: 'child', name: 'Child', parent: '$root' },
    { op: 'set', entity: '$child', fields: { 'Transform.position.x': 5 } },
    { op: 'rename', entity: 1, name: 'Renamed' },
  ];

  it('keeps the rest when the declined op holds nothing up', () => {
    const out = withoutDeclined(ops, new Set([3]));
    expect(out.ops).toHaveLength(3);
    expect(out.dropped).toEqual([3]);
  });

  // Running a `set` whose entity was never created is not a smaller change —
  // it is a throw that rolls the whole batch back.
  it('takes the dependents of a declined create, transitively', () => {
    const out = withoutDeclined(ops, new Set([0]));
    expect(out.dropped).toEqual([0, 1, 2]);
    expect(out.ops).toEqual([{ op: 'rename', entity: 1, name: 'Renamed' }]);
  });

  it('leaves a batch nobody declined alone', () => {
    expect(withoutDeclined(ops, new Set()).ops).toEqual(ops);
  });
});
