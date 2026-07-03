// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { percentile, dominantPhase, sumMs, topSystems } from '@/engine/PerfMonitor';

describe('percentile', () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100

  it('is 0 for an empty sample', () => expect(percentile([], 50)).toBe(0));
  it('returns the value for a single sample', () => expect(percentile([42], 95)).toBe(42));
  it('pins the ends', () => {
    expect(percentile(v, 0)).toBe(1);
    expect(percentile(v, 100)).toBe(100);
  });
  it('is non-decreasing and order-independent', () => {
    const shuffled = [...v].reverse();
    expect(percentile(shuffled, 50)).toBeLessThanOrEqual(percentile(shuffled, 95));
    expect(percentile(shuffled, 95)).toBeLessThanOrEqual(percentile(shuffled, 99));
    expect(percentile(shuffled, 99)).toBeGreaterThan(percentile(shuffled, 50));
  });
});

describe('dominantPhase', () => {
  it('picks the heaviest phase', () => {
    expect(dominantPhase({ 'gizmo.update': 3, 'react.commit': 7, other: 1 })).toEqual({ phase: 'react.commit', ms: 7 });
  });
  it('is null for no phases', () => expect(dominantPhase({})).toBeNull());
});

describe('sumMs', () => {
  it('sums a timing map', () => expect(sumMs({ a: 1.5, b: 2, c: 0.5 })).toBe(4));
  it('is 0 for an empty map', () => expect(sumMs({})).toBe(0));
});

describe('topSystems', () => {
  it('returns the n costliest, descending', () => {
    const got = topSystems({ Render: 3, Physics: 8, Animation: 1, UI: 5 }, 2);
    expect(got).toEqual([{ name: 'Physics', ms: 8 }, { name: 'UI', ms: 5 }]);
  });
  it('caps at the map size', () => {
    expect(topSystems({ a: 1 }, 5)).toEqual([{ name: 'a', ms: 1 }]);
  });
});
