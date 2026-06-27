// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  InputMap document edits — pure, immutable CRUD over actions + bindings,
 *        the editable core of the .inputmap asset (same JSON the runtime loads).
 */
import { describe, it, expect } from 'vitest';
import type { Binding } from 'esengine';
import {
  blankInputMap,
  addAction,
  removeAction,
  renameAction,
  setActionType,
  addBinding,
  removeBinding,
  setBinding,
} from '@/project/inputMapDoc';

const key = (code: string): Binding => ({ kind: 'key', code });

describe('inputMapDoc', () => {
  it('addAction adds a button action, is immutable, and dedups / ignores empty', () => {
    const m0 = blankInputMap();
    const m1 = addAction(m0, 'Jump');
    expect(m1.actions.Jump).toEqual({ type: 'button', bindings: [] });
    expect(m0.actions).toEqual({}); // original untouched
    expect(addAction(m1, 'Jump')).toBe(m1); // existing name → same ref (no-op)
    expect(addAction(m1, '   ')).toBe(m1); // empty → no-op
  });

  it('adds / edits / removes bindings', () => {
    let m = addAction(blankInputMap(), 'Jump');
    m = addBinding(m, 'Jump', key('Space'));
    expect(m.actions.Jump.bindings).toEqual([{ kind: 'key', code: 'Space' }]);
    m = setBinding(m, 'Jump', 0, key('KeyW'));
    expect(m.actions.Jump.bindings[0]).toEqual({ kind: 'key', code: 'KeyW' });
    m = removeBinding(m, 'Jump', 0);
    expect(m.actions.Jump.bindings).toEqual([]);
  });

  it('renameAction preserves list position and rejects collisions', () => {
    let m = addAction(addAction(blankInputMap(), 'A'), 'B');
    m = renameAction(m, 'A', 'Fire');
    expect(Object.keys(m.actions)).toEqual(['Fire', 'B']); // position kept
    expect(m.actions.Fire.type).toBe('button');
    expect(renameAction(m, 'Fire', 'B')).toBe(m); // would collide → no-op
  });

  it('setActionType changes the type; removeAction deletes', () => {
    let m = addAction(blankInputMap(), 'Move');
    m = setActionType(m, 'Move', 'axis2d');
    expect(m.actions.Move.type).toBe('axis2d');
    m = removeAction(m, 'Move');
    expect(m.actions.Move).toBeUndefined();
  });
});
