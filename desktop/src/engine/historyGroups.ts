// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    historyGroups.ts
 * @brief   The undo timeline as the History panel shows it: an agent turn is one
 *          collapsible row, not the thirty-eight steps it took.
 *
 * A turn owns the steps recorded between its own two checkpoints, plus the
 * project files its transaction captured. Both are needed: a turn that only
 * wrote files has no steps at all, and one that only edited the scene has no
 * files, and either alone would leave a turn invisible in the panel.
 *
 * Pure — it takes the two lists and returns rows. The panel renders them, and
 * this is where "what belongs to which turn" can be tested without a viewport.
 */
import type { HistoryChange, HistoryMark, HistoryStep } from './EditorHistory';
import type { AgentTurn } from '@/store/AgentStore';
import type { FileChange } from '../../electron/agent/types';

/** A step the person took by hand. */
export interface StepRow {
  kind: 'step';
  step: HistoryStep;
}

/** One agent turn, and everything it left behind. */
export interface TurnRow {
  kind: 'turn';
  /** The turn's session index — stable across re-renders, so React keys are. */
  id: number;
  prompt: string;
  steps: HistoryStep[];
  files: readonly FileChange[];
  /** The transaction its files came from, for the Revert. Null when none was
   *  open, in which case the files list is empty too. */
  tx: string | null;
  mark: HistoryMark | null;
  /** Where the turn's own work ended — the upper bound of its window. */
  endSeq: number;
  /**
   * Whether reverting this turn would take back only ITSELF. The stack is
   * linear, so undoing to a mark takes back everything recorded after it —
   * a later turn, or the person's own work since. Only the newest group with
   * nothing past it can honestly offer the gesture.
   */
  revertable: boolean;
  /** Every step in it has been undone — the whole row reads as taken back. */
  undone: boolean;
}

export type HistoryRow = StepRow | TurnRow;

/**
 * Fold `steps` into rows, attributing each to the turn whose window it falls in.
 *
 * `turns` must be in conversation order; a turn with no mark (one that failed
 * before taking its checkpoint) owns nothing and appears only if it wrote files.
 */
export function historyRows(
  steps: readonly HistoryStep[],
  turns: readonly AgentTurn[],
): HistoryRow[] {
  // A turn owns what it recorded between its OWN two checkpoints. Bounded by
  // the next run's start, the newest — which has no next — claimed every edit
  // the person made after it, Revert included.
  const windows = turns
    .map((turn) => ({
      turn,
      from: (turn.mark as HistoryMark | null)?.seq ?? null,
      until: (turn.endMark as HistoryMark | null)?.seq ?? null,
    }))
    .filter((w): w is { turn: AgentTurn; from: number; until: number } =>
      w.from !== null && w.until !== null);

  const owner = (id: number) => windows.find((w) => id > w.from && id <= w.until);
  const claimed = new Map<number, TurnRow>();
  const rows: HistoryRow[] = [];

  for (const step of steps) {
    const w = owner(step.id);
    if (!w) {
      rows.push({ kind: 'step', step });
      continue;
    }
    // The turn takes its place at its FIRST step, so a run sits where it ran
    // rather than at the end of the list.
    let row = claimed.get(w.turn.id);
    if (!row) {
      row = turnRow(w.turn, w.until);
      claimed.set(w.turn.id, row);
      rows.push(row);
    }
    row.steps.push(step);
  }

  // A turn that recorded no steps still has its files to show — the case a
  // steps-only reading of a turn missed entirely.
  for (const w of windows) {
    if (!claimed.has(w.turn.id) && w.turn.files.length > 0) {
      const row = turnRow(w.turn, w.until);
      claimed.set(w.turn.id, row);
      rows.push(row);
    }
  }

  for (const row of rows) {
    if (row.kind !== 'turn') continue;
    row.undone = row.steps.length > 0 && row.steps.every((s) => s.undone);
    // A files-only run has no steps to undo, and its transaction is the whole
    // of what there is to take back.
    row.revertable = !row.undone && (row.steps.length > 0 || row.files.length > 0);
  }
  return rows;
}

/** `steps` fills in as the walk goes; `revertable` cannot be known until every
 *  row exists, so both are settled after the fact. */
function turnRow(turn: AgentTurn, endSeq: number): TurnRow {
  return {
    kind: 'turn',
    id: turn.id,
    prompt: turn.prompt,
    steps: [],
    files: turn.files,
    tx: turn.tx,
    mark: turn.mark as HistoryMark | null,
    endSeq,
    revertable: false,
    undone: false,
  };
}

/** `+`/`~`/`−` counts for a row's header, over both kinds of change. */
export interface ChangeTally { add: number; modify: number; remove: number }

export function tally(
  changes: readonly Pick<HistoryChange, 'kind'>[],
  files: readonly FileChange[] = [],
): ChangeTally {
  const out: ChangeTally = { add: 0, modify: 0, remove: 0 };
  for (const c of changes) out[c.kind]++;
  for (const f of files) out[f.kind]++;
  return out;
}

/** Every change a turn's steps declared, oldest first. */
export function turnChanges(row: TurnRow): HistoryChange[] {
  return row.steps.flatMap((s) => [...s.changes]);
}
