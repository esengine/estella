// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  How far going back to a point on the timeline reaches.
 *
 * The plan is what the confirmation states, so it is also what makes the
 * gesture honest: a plan that under-counts lets a rewind take runs nobody was
 * told about, and one that over-counts scares people off the only way back.
 */
import { describe, it, expect } from 'vitest';
import { planRewind } from '@/engine/rewind';
import type { AgentTurn } from '@/store/AgentStore';
import type { FileChange } from '../electron/agent/types';

const file = (path: string): FileChange => ({ path, kind: 'add', unjournaled: false });

const turn = (id: number, from: number, to: number, over: Partial<AgentTurn> = {}): AgentTurn => ({
  id, prompt: `run ${id}`, model: 'opus-5', entries: [],
  inputTokens: 0, outputTokens: 0, context: null,
  steps: to - from, mark: { seq: from }, endMark: { seq: to },
  tx: `tx-${id}`, files: [file(`src/run${id}.ts`)],
  acceptance: { verdict: 'unverified', results: [] },
  reason: 'end_turn', startedAt: 0, endedAt: 1,
  ...over,
});

describe('what going back to a point takes with it', () => {
  it('takes nothing when no run is past the point', () => {
    const plan = planRewind(9, [turn(0, 0, 3)]);
    expect(plan.runs).toEqual([]);
    expect(plan.files).toEqual([]);
  });

  it('takes the run that begins at the point', () => {
    const plan = planRewind(0, [turn(0, 0, 3)]);
    expect(plan.runs.map((r) => r.id)).toEqual([0]);
    expect(plan.files.map((f) => f.path)).toEqual(['src/run0.ts']);
  });

  // The session-level case: going back past the first of five runs has to take
  // the other four's files too, or the project lands somewhere it never was.
  it('takes every run after the point, not just the one clicked', () => {
    const plan = planRewind(0, [turn(0, 0, 3), turn(1, 3, 6), turn(2, 6, 9)]);
    expect(plan.runs.map((r) => r.id)).toEqual([0, 1, 2]);
    expect(plan.files).toHaveLength(3);
  });

  it('leaves the runs that finished before the point alone', () => {
    const plan = planRewind(3, [turn(0, 0, 3), turn(1, 3, 6), turn(2, 6, 9)]);
    expect(plan.runs.map((r) => r.id)).toEqual([1, 2]);
  });

  // A transaction is atomic on disk, so there is no half of one to hand back —
  // a point inside a run is not a place the project can be put. (The panel
  // never offers one: a run's steps are inside its group, not clickable rows.)
  it('does not take a run the point falls inside', () => {
    const plan = planRewind(2, [turn(0, 0, 5)]);
    expect(plan.runs).toEqual([]);
  });

  it('ignores a run that never opened a transaction', () => {
    const plan = planRewind(0, [turn(0, 0, 3, { tx: null, files: [] })]);
    expect(plan.runs).toEqual([]);
  });

  // What it cannot put back is named in the plan, so the confirmation can say
  // it BEFORE the gesture rather than a toast saying it afterwards.
  it('names what it would leave behind', () => {
    const big: FileChange = { path: 'Video/intro.mp4', kind: 'modify', unjournaled: true };
    const plan = planRewind(0, [turn(0, 0, 3, { files: [file('src/a.ts'), big] })]);
    expect(plan.files).toHaveLength(2);
    expect(plan.stranded.map((f) => f.path)).toEqual(['Video/intro.mp4']);
  });

  it('carries the prompts, so the confirmation can name the runs', () => {
    const plan = planRewind(0, [turn(0, 0, 3, { prompt: 'make a health bar' })]);
    expect(plan.runs[0]).toMatchObject({ prompt: 'make a health bar', tx: 'tx-0' });
  });
});
