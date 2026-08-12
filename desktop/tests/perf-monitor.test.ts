// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { percentile, dominantPhase, sumMs, topSystems, profileOf, type FrameSample } from '@/engine/PerfMonitor';

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

describe('profileOf', () => {
  const sample = (over: Partial<FrameSample>): FrameSample => ({
    id: 0, dt: 16.7, t0: 0, t1: 16.7,
    engineMs: 0, editorMs: 0, presentWaitMs: 0, gpuMs: -1,
    editorPhases: {}, enginePhases: {}, cppScopes: {}, gpuScopes: {},
    costs: null, counters: {}, drawCalls: 0, triangles: 0, entities: 0,
    ...over,
  });

  // Real numbers from an empty-scene capture: 2.1ms submit, ~0.02ms C++ work.
  const emptyScene = sample({
    costs: {
      systems: [{ name: 'RenderSystem', ms: 2.107, domain: 'render' }],
      scopes: [
        { name: 'render.submit', ms: 2.1, system: 'RenderSystem', remainder: 'wait' },
        { name: 'render.resolveCameras', ms: 0.007, system: 'RenderSystem', remainder: 'work' },
      ],
    },
    cppScopes: { 'render.collect': 0.013, 'render.submit': 0.006, 'render.finalize': 0.002 },
  });

  it('reads the submit wall minus the C++ render CPU inside it as wait', () => {
    expect(profileOf(emptyScene).waitMs).toBeCloseTo(2.079, 3);
  });

  it('leaves the render system its real CPU once the wait is out', () => {
    expect(profileOf(emptyScene).cpuMs).toBeCloseTo(0.028, 3);
  });

  it('reports no wait when nothing declared one (an SDK without the instrumentation)', () => {
    const plain = sample({
      costs: {
        systems: [{ name: 'RenderSystem', ms: 0.5, domain: 'render' }],
        scopes: [{ name: 'render.resolveCameras', ms: 0.1, system: 'RenderSystem', remainder: 'work' }],
      },
      cppScopes: { 'render.submit': 0.5 },
    });
    expect(profileOf(plain).waitMs).toBe(0);
  });

  it('never goes negative when C++ work exceeds the (tiny) submit wall', () => {
    const inverted = sample({
      costs: {
        systems: [{ name: 'RenderSystem', ms: 0.1, domain: 'render' }],
        scopes: [{ name: 'render.submit', ms: 0.1, system: 'RenderSystem', remainder: 'wait' }],
      },
      cppScopes: { 'render.submit': 0.5 },
    });
    expect(profileOf(inverted).waitMs).toBe(0);
  });

  it('is the whole submit wall when no C++ scopes are reported', () => {
    const noNative = sample({
      costs: {
        systems: [{ name: 'RenderSystem', ms: 1.8, domain: 'render' }],
        scopes: [{ name: 'render.submit', ms: 1.8, system: 'RenderSystem', remainder: 'wait' }],
      },
    });
    expect(profileOf(noNative).waitMs).toBeCloseTo(1.8, 4);
  });

  it('adds up to the frame even with nothing measured', () => {
    const p = profileOf(sample({}));
    expect(p.cpuMs + p.waitMs + p.idleMs).toBeCloseTo(16.7, 4);
  });
});
