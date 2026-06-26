// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  EditorHistory dirty tracking — unsaved-changes state via the edit-id
 *        mirror of the undo stack. Undoing back to the saved point clears dirty
 *        (UE semantics); a fresh edit at the same depth does NOT (new id). Pure TS.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorHistoryImpl } from '@/engine/EditorHistory';

const noop = () => {};
const edit = (h: EditorHistoryImpl, label = 'Edit') => h.record(label, noop, noop);

describe('EditorHistory dirty', () => {
  let h: EditorHistoryImpl;
  beforeEach(() => {
    h = new EditorHistoryImpl();
  });

  it('starts clean', () => {
    expect(h.isDirty()).toBe(false);
  });

  it('an edit makes it dirty; markSaved clears it', () => {
    edit(h);
    expect(h.isDirty()).toBe(true);
    h.markSaved();
    expect(h.isDirty()).toBe(false);
  });

  it('undoing back to the saved point clears dirty; redo re-dirties', () => {
    edit(h);
    h.markSaved(); // saved at depth 1
    edit(h); // depth 2 → dirty
    expect(h.isDirty()).toBe(true);
    h.undo(); // back to depth 1 = saved
    expect(h.isDirty()).toBe(false);
    h.redo(); // forward again → dirty
    expect(h.isDirty()).toBe(true);
  });

  it('an edit after undo is dirty even at the saved DEPTH (id differs, not depth)', () => {
    edit(h); // id 1
    edit(h); // id 2
    h.markSaved(); // saved head = id 2 (depth 2)
    h.undo(); // depth 1, head = id 1 → dirty
    expect(h.isDirty()).toBe(true);
    edit(h); // depth 2 again, but head = id 3 ≠ saved id 2
    expect(h.isDirty()).toBe(true); // a naive depth check would wrongly say clean
  });

  it('clear() resets the clean baseline (scene load / new scene)', () => {
    edit(h);
    expect(h.isDirty()).toBe(true);
    h.clear();
    expect(h.isDirty()).toBe(false);
  });

  it('saving, editing, then undoing to the save is clean again', () => {
    edit(h);
    edit(h);
    h.markSaved();
    edit(h);
    edit(h);
    expect(h.isDirty()).toBe(true);
    h.undo();
    h.undo();
    expect(h.isDirty()).toBe(false); // back at the saved head
  });
});
