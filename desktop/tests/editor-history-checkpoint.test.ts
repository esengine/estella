// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  EditorHistory.mark / undoToMark — the agent-turn checkpoint. Each tool
 *        call stays its own undo step (the user can pick edits apart, and can
 *        edit in between), while the turn as a whole reverts in one gesture.
 *        Pure TS.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorHistoryImpl } from '@/engine/EditorHistory';

describe('EditorHistory checkpoints', () => {
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

  it('reverts everything after the mark, and nothing before it', () => {
    add(1);
    const turn = h.mark();
    add(2);
    add(4);
    expect(value).toBe(7);
    expect(h.stepsSince(turn)).toBe(2);

    expect(h.undoToMark(turn)).toBe(2);
    expect(value).toBe(1); // the pre-mark edit survives
    expect(h.stepsSince(turn)).toBe(0);
  });

  it('leaves the reverted turn on the redo stack', () => {
    const turn = h.mark();
    add(2);
    add(4);
    h.undoToMark(turn);
    expect(value).toBe(0);

    // Undo is not deletion: bringing the turn back is the ordinary redo path.
    h.redo();
    h.redo();
    expect(value).toBe(6);
  });

  it('each step inside the turn is still its own undo step', () => {
    const turn = h.mark();
    add(2);
    add(4);
    h.undo();
    expect(value).toBe(2);
    expect(h.stepsSince(turn)).toBe(1);
    // …and the checkpoint still reverts what is left.
    expect(h.undoToMark(turn)).toBe(1);
    expect(value).toBe(0);
  });

  it('a mark taken on an empty stack means "back to nothing"', () => {
    const turn = h.mark();
    add(1);
    add(2);
    expect(h.undoToMark(turn)).toBe(2);
    expect(value).toBe(0);
    expect(h.canUndo()).toBe(false);
  });

  it('reverting an untouched turn does nothing and reports nothing', () => {
    add(1);
    const turn = h.mark();
    expect(h.stepsSince(turn)).toBe(0);
    expect(h.undoToMark(turn)).toBe(0);
    expect(value).toBe(1);
  });

  // A mark is a sequence number, not a reference to an entry, so the two ways a
  // stack loses entries cannot turn it into a rollback of unrelated work.
  it('survives a purge of the entries underneath it', () => {
    h.record('Doc edit', () => {}, () => {}, 'doc-a');
    const turn = h.mark();
    add(2);
    h.purgeDoc('doc-a'); // the pre-mark entry is gone
    expect(h.stepsSince(turn)).toBe(1);
    expect(h.undoToMark(turn)).toBe(1);
    expect(value).toBe(0);
  });

  it('stops at the bottom when the marked point scrolled out of the limit', () => {
    add(1);
    const turn = h.mark();
    // Overrun HISTORY_LIMIT so the pre-mark entry is shifted away.
    for (let i = 0; i < 210; i++) add(1);
    const before = value;
    const undone = h.undoToMark(turn);
    expect(undone).toBe(200); // the whole (capped) stack, all of it post-mark
    expect(value).toBe(before - 200);
    expect(h.canUndo()).toBe(false);
  });

  it('notifies once for the whole rollback, not once per step', () => {
    const turn = h.mark();
    add(1);
    add(2);
    add(4);
    const v0 = h.getVersion();
    h.undoToMark(turn);
    expect(h.getVersion()).toBe(v0 + 1);
  });
});
