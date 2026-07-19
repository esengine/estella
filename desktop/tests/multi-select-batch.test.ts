// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Multi-selection commands batch into ONE undo step per gesture:
 *        deleteEntities / duplicateEntities / reparentEntities / cutEntities.
 *        Pure TS (real model + history, no WASM).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { SceneModelImpl } from '@/engine/SceneModel';
import { EditorHistoryImpl } from '@/engine/EditorHistory';
import { SceneCommandsImpl } from '@/engine/SceneCommands';

const ent = (id: number, parent: number | null = null, children: number[] = []) => ({
  id,
  name: `E${id}`,
  parent,
  children,
  visible: true,
  components: [
    { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
  ],
});

function scene(): SceneData {
  // 1, 2, 3 roots; 4 is a child of 3.
  return {
    version: '1.0',
    name: 't',
    entities: [ent(1), ent(2), ent(3, null, [4]), ent(4, 3)],
  } as unknown as SceneData;
}

const undoDepth = (h: EditorHistoryImpl): number => {
  let n = 0;
  while (h.canUndo()) {
    h.undo();
    n++;
  }
  for (let i = 0; i < n; i++) h.redo();
  return n;
};

describe('multi-selection batching', () => {
  let model: SceneModelImpl;
  let history: EditorHistoryImpl;
  let cmds: SceneCommandsImpl;

  beforeEach(() => {
    model = new SceneModelImpl();
    history = new EditorHistoryImpl();
    cmds = new SceneCommandsImpl(model, history);
    model.adopt(scene(), new Map([[1, 101], [2, 102], [3, 103], [4, 104]]));
  });

  it('deleteEntities removes all roots (with subtrees) as one undo step', () => {
    cmds.deleteEntities([1, 3]);
    expect(model.entityBySource(1)).toBeUndefined();
    expect(model.entityBySource(3)).toBeUndefined();
    expect(model.entityBySource(4)).toBeUndefined(); // subtree went with 3
    expect(undoDepth(history)).toBe(1);
    expect(history.undoLabel()).toBe('Delete 2 Entities');
    history.undo();
    expect(model.entityBySource(1)).toBeDefined();
    expect(model.entityBySource(3)).toBeDefined();
    expect(model.entityBySource(4)).toBeDefined();
  });

  it('deleteEntities of a single id keeps the named single-delete step', () => {
    cmds.deleteEntities([2]);
    expect(history.undoLabel()).toBe('Delete E2');
    expect(undoDepth(history)).toBe(1);
  });

  it('duplicateEntities clones every selected entity as one undo step', () => {
    const dups = cmds.duplicateEntities([1, 2]);
    expect(dups).toHaveLength(2);
    for (const d of dups) expect(model.entityBySource(d)).toBeDefined();
    expect(undoDepth(history)).toBe(1);
    history.undo();
    for (const d of dups) expect(model.entityBySource(d)).toBeUndefined();
    history.redo();
    for (const d of dups) expect(model.entityBySource(d)).toBeDefined();
  });

  it('reparentEntities moves the whole drag as one undo step', () => {
    cmds.reparentEntities([1, 2], 3);
    expect(model.entityBySource(1)?.parent).toBe(3);
    expect(model.entityBySource(2)?.parent).toBe(3);
    expect(undoDepth(history)).toBe(1);
    history.undo();
    expect(model.entityBySource(1)?.parent ?? null).toBeNull();
    expect(model.entityBySource(2)?.parent ?? null).toBeNull();
  });

  it('reparentEntities keeps per-id rules (skips the target + cycles)', () => {
    cmds.reparentEntities([3, 4, 1], 4); // 3→4 is a cycle, 4→4 is self; only 1 moves
    expect(model.entityBySource(3)?.parent ?? null).toBeNull();
    expect(model.entityBySource(1)?.parent).toBe(4);
  });

  it('cutEntities copies then deletes as one undo step', () => {
    const n = cmds.cutEntities([1, 2]);
    expect(n).toBe(2);
    expect(model.entityBySource(1)).toBeUndefined();
    expect(model.entityBySource(2)).toBeUndefined();
    expect(undoDepth(history)).toBe(1);
    history.undo();
    expect(model.entityBySource(1)).toBeDefined();
    expect(model.entityBySource(2)).toBeDefined();
  });

  it('duplicateEntity deep-copies the subtree — children come along (not just the root)', () => {
    const dup = cmds.duplicateEntity(3); // 3 has child 4
    expect(dup).not.toBeNull();
    const root = model.entityBySource(dup!);
    expect(root?.children.length).toBe(1); // the cloned child, NOT dropped
    const childSrc = root!.children[0];
    expect(childSrc).not.toBe(4);              // a fresh source id
    expect(model.entityBySource(childSrc)?.parent).toBe(dup);
    // Undo/redo carry the whole subtree.
    expect(undoDepth(history)).toBe(1);
    history.undo();
    expect(model.entityBySource(dup!)).toBeUndefined();
    expect(model.entityBySource(childSrc)).toBeUndefined();
    history.redo();
    expect(model.entityBySource(dup!)?.children.length).toBe(1);
  });

  it('reorderEntities batches a multi-drag into one undo step', () => {
    cmds.reorderEntities([1, 2], 3, false); // both move after 3 → real order change
    expect(undoDepth(history)).toBe(1);
    expect(history.undoLabel()).toBe('Reorder 2 Entities');
  });

  it('a single-axis edit fanned across a multi-selection keeps each entity\'s own other axes', () => {
    // Give 1 and 2 distinct Y (their own values on the axis we will NOT touch).
    cmds.setField(1, 'Transform', 'position', 'vec3', [0, 10, 0]);
    cmds.setField(2, 'Transform', 'position', 'vec3', [0, 20, 0]);
    // Edit only X across both — NaN on Y/Z is the "keep own value" sentinel the
    // Inspector's VecControl emits for the untouched axes.
    cmds.beginGesture('Edit position');
    for (const e of [1, 2]) cmds.setField(e, 'Transform', 'position', 'vec3', [42, NaN, NaN]);
    cmds.endGesture();
    const pos = (id: number) =>
      model.entityBySource(id)!.components.find((c) => c.type === 'Transform')!.data.position as { x: number; y: number };
    expect(pos(1)).toMatchObject({ x: 42, y: 10 }); // kept its own Y
    expect(pos(2)).toMatchObject({ x: 42, y: 20 }); // kept its own Y (not clobbered to 10)
  });
});
