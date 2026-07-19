// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Telemetry loops stop on project close. Returning to the launcher must
 *        halt StatsStore's 333ms sampling loop and PerfMonitor's rAF/longtask
 *        observers — otherwise they poll wasm forever after the Viewport that
 *        started them has unmounted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StatsStore } from '@/engine/StatsStore';
import { PerfMonitor } from '@/engine/PerfMonitor';

let rafCbs: FrameRequestCallback[];

beforeEach(() => {
  rafCbs = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafCbs.push(cb));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  StatsStore.stop();
  PerfMonitor.stop();
  vi.unstubAllGlobals();
});

describe('StatsStore.stop', () => {
  it('halts the sampling loop so it stops rescheduling', () => {
    StatsStore.start();
    expect(rafCbs).toHaveLength(1);
    rafCbs[rafCbs.length - 1](1000); // running → reschedules
    expect(rafCbs).toHaveLength(2);

    StatsStore.stop();
    rafCbs[rafCbs.length - 1](1333); // stopped → must not reschedule
    expect(rafCbs).toHaveLength(2);
  });

  it('restarts cleanly after a stop (a new Viewport mount)', () => {
    StatsStore.start();
    StatsStore.stop();
    StatsStore.start();
    expect(rafCbs.length).toBeGreaterThan(0);
  });
});

describe('PerfMonitor.stop', () => {
  it('cancels the rAF loop and stops rescheduling', () => {
    PerfMonitor.start();
    expect(rafCbs).toHaveLength(1);
    PerfMonitor.stop();
    expect(cancelAnimationFrame).toHaveBeenCalled();

    const before = rafCbs.length;
    rafCbs[rafCbs.length - 1](16); // stopped → must not reschedule
    expect(rafCbs).toHaveLength(before);
  });
});
