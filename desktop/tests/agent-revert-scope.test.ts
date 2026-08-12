// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  When a finished turn is worth offering a revert for, and what it covers.
 *
 * The policy, not the bar that renders it: the interesting cases are about which
 * halves of a turn's work exist, and a turn that only wrote files is the one a
 * steps-only checkpoint had nothing to say about.
 */
import { describe, it, expect } from 'vitest';
import { revertScope, canCarryOn, type AgentTurn } from '@/store/AgentStore';
import type { FileChange } from '../electron/agent/types';

const turn = (over: Partial<AgentTurn>): AgentTurn => ({
  id: 0, prompt: 'add a health bar', model: 'opus-5', entries: [],
  inputTokens: 0, outputTokens: 0, context: null,
  steps: 0, mark: { seq: 1 }, endMark: null, tx: null, files: [], acceptance: { verdict: 'unverified', results: [] }, 
  reason: 'end_turn', startedAt: 0, endedAt: 1,
  ...over,
});

const file = (path: string, over: Partial<FileChange> = {}): FileChange =>
  ({ path, kind: 'add', unjournaled: false, ...over });

describe('what a turn offers to take back', () => {
  it('offers nothing for a turn that changed nothing', () => {
    expect(revertScope(turn({}), 0)).toBeNull();
  });

  it('offers nothing while the turn is still running', () => {
    expect(revertScope(turn({ reason: null, steps: 4 }), 4)).toBeNull();
  });

  it('offers the scene edits a turn recorded', () => {
    expect(revertScope(turn({ steps: 7 }), 7)).toMatchObject({ steps: 7, files: [] });
  });

  // The case a steps-only checkpoint could not see: writing a script and a
  // prefab records no undo steps at all, so the bar never appeared for the work
  // undo was least able to reach.
  it('offers a turn that only wrote files', () => {
    const scope = revertScope(turn({ steps: 0, endMark: null, tx: 'tx-1', files: [file('src/HealthBar.ts')] }), 0);
    expect(scope).toMatchObject({ steps: 0, files: [{ path: 'src/HealthBar.ts' }] });
  });

  it('says when the user has edited past the turn', () => {
    expect(revertScope(turn({ steps: 2 }), 5)).toMatchObject({ stale: true });
    expect(revertScope(turn({ steps: 2 }), 2)).toMatchObject({ stale: false });
  });

  // Undone by hand down past the mark: fewer steps than the turn recorded is not
  // stale, and the bar must not claim the user edited over it.
  it('is not stale when the stack has shrunk instead', () => {
    expect(revertScope(turn({ steps: 5 }), 1)).toMatchObject({ stale: false });
  });

  // Named separately rather than folded into the count: a revert that leaves
  // them behind must not be shown as having taken the whole turn back.
  it('separates the files it cannot put back', () => {
    const scope = revertScope(turn({
      tx: 'tx-1',
      files: [file('src/HP.ts'), file('Video/intro.mp4', { kind: 'modify', unjournaled: true })],
    }), 0);
    expect(scope?.files).toHaveLength(2);
    expect(scope?.stranded.map((f) => f.path)).toEqual(['Video/intro.mp4']);
  });
});

/**
 * When carrying on is still worth offering.
 *
 * The offer exists to continue WORK. A run that ended where it could go on but
 * changed nothing produced none, and offering it again is how a long task turns
 * into the same round trip repeated — each press starting a fresh budget.
 */
describe('whether to offer carrying on', () => {
  const ran = (over: Partial<AgentTurn>): AgentTurn => turn({ steps: 3, ...over });
  const nothing = (reason: AgentTurn['reason']): AgentTurn =>
    turn({ reason, steps: 0, files: [] });

  it('offers it after a run that stopped part-way having done something', () => {
    expect(canCarryOn([ran({ reason: 'max_rounds' })])).toBe(true);
    expect(canCarryOn([ran({ reason: 'aborted' })])).toBe(true);
    expect(canCarryOn([ran({ reason: 'error' })])).toBe(true);
  });

  it('does not offer it for a run that finished', () => {
    expect(canCarryOn([ran({ reason: 'end_turn' })])).toBe(false);
    expect(canCarryOn([ran({ reason: 'refusal' })])).toBe(false);
  });

  // One fruitless run is a dropped socket; the offer is exactly what it is for.
  it('still offers it after ONE fruitless run', () => {
    expect(canCarryOn([nothing('error')])).toBe(true);
    expect(canCarryOn([ran({ reason: 'end_turn' }), nothing('error')])).toBe(true);
  });

  // Two is a loop, and the button is what feeds it.
  it('withdraws it after two fruitless runs in a row', () => {
    expect(canCarryOn([nothing('error'), nothing('error')])).toBe(false);
    expect(canCarryOn([nothing('max_rounds'), nothing('aborted')])).toBe(false);
  });

  it('offers it again once a run got somewhere', () => {
    expect(canCarryOn([nothing('error'), ran({ reason: 'max_rounds' })])).toBe(true);
  });

  // Files count as having got somewhere: a turn that only wrote scripts records
  // no undo steps, and reading steps alone would call it fruitless.
  it('counts a run that only wrote files as having got somewhere', () => {
    const wrote = turn({
      reason: 'max_rounds', steps: 0,
      files: [{ path: 'src/HP.ts', kind: 'add', unjournaled: false }],
    });
    expect(canCarryOn([nothing('error'), wrote])).toBe(true);
  });

  it('offers nothing when there are no runs at all', () => {
    expect(canCarryOn([])).toBe(false);
  });
});
