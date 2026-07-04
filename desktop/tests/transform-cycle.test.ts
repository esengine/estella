// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Click-through selection cycling: clicking the same spot on a stack of
 *        overlapping entities walks down to the next one, wrapping.
 */
import { describe, it, expect } from 'vitest';
import { stepCycle, sameCycleSpot, type CycleState } from '@/tools/transformTools';

const STACK = [10, 20, 30]; // topmost-first

describe('stepCycle', () => {
  it('first click selects the topmost and seeds the cycle', () => {
    const r = stepCycle(STACK, null, 100, 100)!;
    expect(r.pick).toBe(10);
    expect(r.cycle).toEqual({ x: 100, y: 100, key: '10,20,30', idx: 0 });
  });

  it('repeated clicks at the same spot walk down and wrap', () => {
    let c: CycleState | null = null;
    const picks: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = stepCycle(STACK, c, 100, 100)!;
      picks.push(r.pick);
      c = r.cycle;
    }
    expect(picks).toEqual([10, 20, 30, 10]);
  });

  it('a click within the slop still counts as the same spot', () => {
    const first = stepCycle(STACK, null, 100, 100)!;
    expect(stepCycle(STACK, first.cycle, 103, 97)!.pick).toBe(20); // advanced
  });

  it('a click beyond the slop restarts at the topmost', () => {
    const first = stepCycle(STACK, null, 100, 100)!;
    expect(stepCycle(STACK, first.cycle, 200, 200)!.pick).toBe(10); // reset
  });

  it('a different stack at the same spot restarts', () => {
    const first = stepCycle(STACK, null, 100, 100)!;
    expect(stepCycle([40, 50], first.cycle, 100, 100)!.pick).toBe(40);
  });

  it('a single-entity (or empty) stack has nothing to cycle', () => {
    expect(stepCycle([10], null, 100, 100)).toBeNull();
    expect(stepCycle([], null, 100, 100)).toBeNull();
  });
});

describe('sameCycleSpot', () => {
  const c: CycleState = { x: 100, y: 100, key: '10,20,30', idx: 1 };
  it('matches within the slop on the same stack', () => {
    expect(sameCycleSpot(c, '10,20,30', 104, 96)).toBe(true);
  });
  it('rejects a far click, a different stack, or no prior cycle', () => {
    expect(sameCycleSpot(c, '10,20,30', 120, 100)).toBe(false);
    expect(sameCycleSpot(c, '10,20', 100, 100)).toBe(false);
    expect(sameCycleSpot(null, '10,20,30', 100, 100)).toBe(false);
  });
});
