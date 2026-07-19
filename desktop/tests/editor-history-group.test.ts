// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  EditorHistory.group — every step recorded inside the callback collapses
 *        into ONE undo step (the multi-selection gesture door). Pure TS.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorHistoryImpl } from '@/engine/EditorHistory';

describe('EditorHistory group', () => {
  let h: EditorHistoryImpl;
  let value: number;
  beforeEach(() => {
    h = new EditorHistoryImpl();
    value = 0;
  });

  const add = (n: number) => {
    value += n;
    h.record(`Add ${n}`, () => { value += n; }, () => { value -= n; });
  };

  it('collapses several record() calls into one undo step', () => {
    h.group('Batch', () => { add(1); add(2); add(4); });
    expect(value).toBe(7);
    expect(h.undoLabel()).toBe('Batch');
    h.undo();
    expect(value).toBe(0); // all three reversed by ONE undo
    expect(h.canUndo()).toBe(false);
    h.redo();
    expect(value).toBe(7);
  });

  it('run() inside a group applies forward immediately and joins the step', () => {
    h.group('Batch', () => {
      h.run('Set', () => { value = 5; }, () => { value = 0; });
    });
    expect(value).toBe(5);
    h.undo();
    expect(value).toBe(0);
  });

  it('an empty group records no step', () => {
    h.group('Nothing', () => {});
    expect(h.canUndo()).toBe(false);
    expect(h.isDirty()).toBe(false);
  });

  it('a nested group folds into the outer one (one step, outer label)', () => {
    h.group('Outer', () => {
      add(1);
      h.group('Inner', () => add(2));
    });
    expect(h.undoLabel()).toBe('Outer');
    h.undo();
    expect(value).toBe(0);
    expect(h.canUndo()).toBe(false);
  });

  it('reverses ops LIFO within the step', () => {
    const order: string[] = [];
    h.group('Batch', () => {
      h.record('a', () => {}, () => order.push('a'));
      h.record('b', () => {}, () => order.push('b'));
    });
    h.undo();
    expect(order).toEqual(['b', 'a']);
  });

  it('recording after the group is a separate step again', () => {
    h.group('Batch', () => add(1));
    add(2);
    expect(h.undoLabel()).toBe('Add 2');
    h.undo();
    expect(value).toBe(1);
    h.undo();
    expect(value).toBe(0);
  });

  it('a throwing callback still commits what it recorded (and rethrows)', () => {
    expect(() =>
      h.group('Boom', () => {
        add(1);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(value).toBe(1);
    h.undo();
    expect(value).toBe(0);
  });
});
