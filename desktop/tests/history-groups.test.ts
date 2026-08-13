// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which steps belong to which agent turn, and which turn may offer a
 *        one-gesture revert.
 *
 * The panel's whole claim is that a run is ONE row. Getting the window wrong
 * either scatters a turn's work across the timeline or lets one turn swallow
 * the edits the person made after it — and the second is worse, because the
 * Revert on that row would then take back work the agent never touched.
 */
import { describe, it, expect } from 'vitest';
import { historyRows, tally, turnChanges, type TurnRow } from '@/engine/historyGroups';
import type { HistoryStep } from '@/engine/EditorHistory';
import type { AgentTurn } from '@/store/AgentStore';
import type { FileChange } from '../electron/agent/types';

const step = (id: number, label = `step ${id}`, undone = false): HistoryStep =>
  ({ id, label, doc: null, changes: [], undone });

/** A run over the half-open window (from, to] — the two checkpoints it took. */
const turn = (id: number, from: number, to: number, over: Partial<AgentTurn> = {}): AgentTurn => ({
  id, prompt: `turn ${id}`, model: 'opus-5', entries: [],
  inputTokens: 0, outputTokens: 0, context: null,
  steps: to - from, mark: { seq: from }, endMark: { seq: to }, tx: null, files: [], 
  acceptance: { verdict: 'unverified', results: [] },
  reason: 'end_turn', startedAt: 0, endedAt: 1,
  ...over,
});

const file = (path: string, kind: FileChange['kind'] = 'add'): FileChange =>
  ({ path, kind, unjournaled: false });

const turns = (rows: ReturnType<typeof historyRows>): TurnRow[] =>
  rows.filter((r): r is TurnRow => r.kind === 'turn');

describe('folding the timeline into rows', () => {
  it('leaves hand edits as their own rows', () => {
    const rows = historyRows([step(1), step(2)], []);
    expect(rows.map((r) => r.kind)).toEqual(['step', 'step']);
  });

  it('gathers a turn 38 steps long into one row', () => {
    const steps = Array.from({ length: 38 }, (_, i) => step(i + 1));
    const rows = historyRows(steps, [turn(0, 0, 38)]);
    expect(rows).toHaveLength(1);
    expect(turns(rows)[0].steps).toHaveLength(38);
  });

  // The mark is taken BEFORE the turn's first step, so the step recorded at the
  // mark's own seq belongs to whatever came before it.
  it('claims steps after its mark, not the one at it', () => {
    const rows = historyRows([step(1), step(2), step(3)], [turn(0, 1, 3)]);
    expect(rows[0]).toMatchObject({ kind: 'step', step: { id: 1 } });
    expect(turns(rows)[0].steps.map((s) => s.id)).toEqual([2, 3]);
  });

  // The failure that matters: without the upper bound a turn owns everything
  // after it, so its Revert would reach into the person's later work.
  it('stops at the next turn, and does not swallow what came between', () => {
    const rows = historyRows(
      [step(1), step(2), step(3), step(4), step(5)],
      [turn(0, 0, 3), turn(1, 3, 5)],
    );
    const [first, second] = turns(rows);
    expect(first.steps.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(second.steps.map((s) => s.id)).toEqual([4, 5]);
  });

  it('keeps a hand edit made between two turns out of both', () => {
    // Turn 0 marked at 0 and recorded step 1; the person then made step 2;
    // turn 1 marked at 2.
    const rows = historyRows([step(1), step(2), step(3)], [turn(0, 0, 2), turn(1, 2, 3)]);
    expect(turns(rows)[0].steps.map((s) => s.id)).toEqual([1, 2]);
    expect(turns(rows)[1].steps.map((s) => s.id)).toEqual([3]);
  });

  // Found by looking at the panel: bounded by the NEXT run's start, the newest
  // run — which has no next — swallowed the edit made right after it, and its
  // Revert would have taken that back under the agent's name.
  it('leaves an edit made after the newest run out of it', () => {
    const rows = historyRows([step(1), step(2), step(3)], [turn(0, 0, 2)]);
    expect(rows[0].kind).toBe('turn');
    expect((rows[0] as TurnRow).steps.map((s) => s.id)).toEqual([1, 2]);
    expect(rows[1]).toMatchObject({ kind: 'step', step: { id: 3 } });
  });

  it('sits where it ran, not at the end of the list', () => {
    const rows = historyRows([step(1), step(2), step(3)], [turn(0, 1, 3)]);
    // step 1 by hand, then the turn — so the turn is the SECOND row.
    expect(rows[0].kind).toBe('step');
    expect(rows[1].kind).toBe('turn');
    expect(rows).toHaveLength(2);
  });

  // The case a steps-only reading missed entirely: writing a script records no
  // undo steps, so this turn exists only because of its files.
  it('shows a turn that only wrote files', () => {
    const rows = historyRows([], [turn(0, 0, 0, { tx: 'tx-1', files: [file('src/HP.ts')] })]);
    expect(turns(rows)[0]).toMatchObject({ files: [{ path: 'src/HP.ts' }], tx: 'tx-1' });
  });

  // Appended after the walk, a run that recorded no steps sat below every run
  // that came later and read as the newest thing on the timeline.
  it('puts a files-only run where it ran, not after the steps that followed it', () => {
    const rows = historyRows(
      [step(1), step(2)],
      [turn(0, 0, 0, { tx: 'tx-a', files: [file('src/A.ts')] }), turn(1, 1, 2)],
    );
    expect(rows.map((r) => r.kind)).toEqual(['turn', 'step', 'turn']);
    expect((rows[0] as TurnRow).id).toBe(0);
    expect((rows[2] as TurnRow).id).toBe(1);
  });

  it('keeps two files-only runs in the order they ran', () => {
    const rows = historyRows([step(1)], [
      turn(0, 0, 0, { tx: 'tx-a', files: [file('src/A.ts')] }),
      turn(1, 0, 0, { tx: 'tx-b', files: [file('src/B.ts')] }),
    ]);
    expect(turns(rows).map((r) => r.id)).toEqual([0, 1]);
    expect(rows[2]).toMatchObject({ kind: 'step', step: { id: 1 } });
  });

  it('shows nothing for a turn that did neither', () => {
    expect(historyRows([], [turn(0, 0, 0)])).toEqual([]);
  });

  it('ignores a turn that never got a mark', () => {
    const rows = historyRows([step(1)], [turn(0, 0, 1, { mark: null })]);
    expect(rows.map((r) => r.kind)).toEqual(['step']);
  });
});

describe('which turn may offer a Revert', () => {
  // The stack is linear, so going back to an older run takes every later run
  // with it — which the confirmation states before anything moves. Offering it
  // only on the newest is what left a session with no way back at all.
  it('offers it on every run that still has work in it', () => {
    const rows = historyRows([step(1), step(2)], [turn(0, 0, 1), turn(1, 1, 2)]);
    expect(turns(rows).map((r) => r.revertable)).toEqual([true, true]);
  });

  it('withdraws it once the turn has been undone by hand', () => {
    const rows = historyRows([step(1, 'a', true)], [turn(0, 0, 1)]);
    expect(turns(rows)[0]).toMatchObject({ revertable: false, undone: true });
  });

  it('keeps offering it while only part of the turn is undone', () => {
    const rows = historyRows([step(1), step(2, 'b', true)], [turn(0, 0, 2)]);
    expect(turns(rows)[0]).toMatchObject({ revertable: true, undone: false });
  });

  // Its steps are all undone, but the files it wrote are still on disk, and the
  // transaction is the only thing that takes them back.
  it('offers it on a files-only run whose steps are gone', () => {
    const rows = historyRows([], [turn(0, 0, 0, { tx: 'tx-1', files: [file('src/HP.ts')] })]);
    expect(turns(rows)[0].revertable).toBe(true);
  });

  it('still offers it when the person has edited past the run', () => {
    const rows = historyRows([step(1), step(2)], [turn(0, 0, 1)]);
    expect(turns(rows)[0].revertable).toBe(true);
  });

  // A reverted transaction hands its copies back and cannot re-apply them, so a
  // second press has nothing to give — and a files-only run has no undone step
  // to work that out from.
  it('withdraws it from a run a rewind already took', () => {
    const rows = historyRows([], [turn(0, 0, 0, {
      tx: 'tx-1', files: [file('src/HP.ts')], reverted: true,
    })]);
    expect(turns(rows)[0]).toMatchObject({ revertable: false, undone: true });
  });
});

describe('what a row counts', () => {
  it('adds entity and file changes into one tally', () => {
    const counts = tally(
      [{ kind: 'add' }, { kind: 'modify' }, { kind: 'modify' }],
      [file('a.ts'), file('b.esscene', 'modify'), file('c.png', 'remove')],
    );
    expect(counts).toEqual({ add: 2, modify: 3, remove: 1 });
  });

  it('reads a turn changes oldest first, across its steps', () => {
    const withChange = (id: number, name: string): HistoryStep => ({
      ...step(id),
      changes: [{ kind: 'add', entity: id, name }],
    });
    const rows = historyRows([withChange(1, 'Canvas'), withChange(2, 'HPBar')], [turn(0, 0, 2)]);
    expect(turnChanges(turns(rows)[0]).map((c) => c.name)).toEqual(['Canvas', 'HPBar']);
  });
});
