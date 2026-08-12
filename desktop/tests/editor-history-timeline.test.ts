// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  EditorHistory.list / goTo — the stack as a timeline someone can read
 *        and click through, rather than only step back along.
 *
 * The claim under test is that an undone step is still SOMEWHERE, and that
 * clicking a row lands exactly there whichever direction it is in. Pure TS.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorHistoryImpl } from '@/engine/EditorHistory';

describe('the timeline a panel reads', () => {
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

  it('lists the steps oldest first, with what each declared', () => {
    h.describe({ kind: 'add', entity: 3, name: 'Canvas' });
    add(1);
    add(2);
    expect(h.list().map((s) => s.label)).toEqual(['Add 1', 'Add 2']);
    expect(h.list()[0].changes).toEqual([{ kind: 'add', entity: 3, name: 'Canvas' }]);
  });

  // Dropping them would make the panel a list of the past. They are places you
  // can go forward to, and the panel's job is to show that they are there.
  it('keeps undone steps on the timeline, flagged', () => {
    add(1);
    add(2);
    h.undo();
    expect(h.list().map((s) => [s.label, s.undone]))
      .toEqual([['Add 1', false], ['Add 2', true]]);
  });

  // Reversed twice on the way through: the redo stack is LIFO, so a naive read
  // would show two undone steps in the wrong order.
  it('keeps undone steps in the order they happened', () => {
    add(1);
    add(2);
    add(4);
    h.undo();
    h.undo();
    expect(h.list().map((s) => s.label)).toEqual(['Add 1', 'Add 2', 'Add 4']);
    expect(h.list().map((s) => s.undone)).toEqual([false, true, true]);
  });

  it('goes back to a row behind the head', () => {
    add(1);
    add(2);
    add(4);
    const target = h.list()[0].id;
    h.goTo(target);
    expect(value).toBe(1);
    expect(h.list().map((s) => s.undone)).toEqual([false, true, true]);
  });

  it('goes forward to a row that had been undone', () => {
    add(1);
    add(2);
    add(4);
    h.goTo(h.list()[0].id);
    h.goTo(h.list()[2].id);
    expect(value).toBe(7);
    expect(h.list().every((s) => !s.undone)).toBe(true);
  });

  it('lands on the row asked for, not one past it', () => {
    add(1);
    add(2);
    add(4);
    h.goTo(h.list()[1].id);
    expect(value).toBe(3);
  });

  it('does nothing for an id the timeline does not hold', () => {
    add(1);
    h.goTo(9999);
    expect(value).toBe(1);
  });

  // Everything back: the id before the first step. Reached by clicking the row
  // above the oldest one is not a thing, so this is what "undo all" resolves to.
  it('unwinds the whole timeline for an id below the first', () => {
    add(1);
    add(2);
    h.goTo(0);
    expect(value).toBe(0);
    expect(h.list().every((s) => s.undone)).toBe(true);
  });
});
