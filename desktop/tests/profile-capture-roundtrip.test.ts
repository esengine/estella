// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  profile-capture-roundtrip.test.ts — a captured frame survives being
 *        written, read back and summarized, so the panel showing a file and the
 *        panel showing the live realm are showing the same numbers.
 */
import { describe, it, expect } from 'vitest';
import { parseProfileCapture, summarizeCapture, frameProfileOf, PROFILE_CAPTURE_VERSION } from 'esengine';
import type { ProfileCapture } from 'esengine';
import { capturedFrameOf, profileOf, type FrameSample } from '@/engine/PerfMonitor';

const sample = (over: Partial<FrameSample> = {}): FrameSample => ({
  id: 7,
  dt: 20,
  t0: 0,
  t1: 20,
  engineMs: 4,
  editorMs: 1.5,
  presentWaitMs: 0,
  gpuMs: 3.2,
  editorPhases: { 'react.Details': 1.5 },
  enginePhases: { Update: 4 },
  cppScopes: { 'render.collect': 0.4 },
  gpuScopes: { 'gpu.submit': 3.2 },
  costs: {
    systems: [
      { name: 'RenderSystem', ms: 3, domain: 'render' },
      { name: 'EnemyAI', ms: 1, domain: 'scripts', query: { calls: 2, scanned: 400, filtered: 380 } },
    ],
    scopes: [{ name: 'render.submit', ms: 2, system: 'RenderSystem', remainder: 'wait' }],
  },
  counters: { 'batch.draws': 6, 'batch.break.shader': 2 },
  drawCalls: 6,
  triangles: 120,
  entities: 50,
  ...over,
});

const captureOf = (samples: FrameSample[]): ProfileCapture => ({
  version: PROFILE_CAPTURE_VERSION,
  generatedAt: '2026-08-12T00:00:00.000Z',
  source: { realm: 'play' },
  budgetMs: 1000 / 60,
  frames: samples.map(capturedFrameOf),
});

/** Through JSON, as a real file would be. */
function roundTrip(capture: ProfileCapture): ProfileCapture {
  const parsed = parseProfileCapture(JSON.stringify(capture));
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.capture;
}

describe('a live frame written as a capture and read back', () => {
  it('folds into the same tree it did live', () => {
    const s = sample();
    const live = profileOf(s);
    const read = frameProfileOf(roundTrip(captureOf([s])).frames[0]);

    expect(read.cpuMs).toBeCloseTo(live.cpuMs, 6);
    expect(read.waitMs).toBeCloseTo(live.waitMs, 6);
    expect(read.idleMs).toBeCloseTo(live.idleMs, 6);
    expect(read.domains.map((d) => `${d.id}:${d.ms}`)).toEqual(live.domains.map((d) => `${d.id}:${d.ms}`));
  });

  it('keeps the wait out of the tree on the way through', () => {
    const read = frameProfileOf(roundTrip(captureOf([sample()])).frames[0]);
    expect(read.waitMs).toBeCloseTo(1.6, 6);
    expect(read.cpuMs + read.waitMs + read.idleMs).toBeCloseTo(read.frameMs, 6);
  });

  it('carries the query cost that explains a system', () => {
    const read = roundTrip(captureOf([sample()]));
    const enemy = read.frames[0].systems.find((x) => x.name === 'EnemyAI');
    expect(enemy?.query).toEqual({ calls: 2, scanned: 400, filtered: 380 });
  });

  it('carries the counters a draw-call count is made of', () => {
    const s = summarizeCapture(roundTrip(captureOf([sample(), sample({ id: 8 })])));
    expect(s.counters['batch.break.shader']).toBeCloseTo(2, 6);
    expect(s.drawCalls).toBeCloseTo(6, 6);
  });

  it('summarizes the file the same way the live window summarizes its frames', () => {
    const frames = [sample({ id: 1, dt: 16 }), sample({ id: 2, dt: 40 }), sample({ id: 3, dt: 16 })];
    const s = summarizeCapture(roundTrip(captureOf(frames)));

    expect(s.frames).toBe(3);
    expect(s.worstFrameId).toBe(2);
    expect(s.longFrames).toBe(1);
    expect(s.mean.cpuMs + s.mean.waitMs + s.mean.idleMs).toBeCloseTo(s.mean.frameMs, 6);
  });

  it('keeps the editor own cost, which a shipped game will not have', () => {
    const read = roundTrip(captureOf([sample()]));
    expect(read.frames[0].editor).toEqual({ ms: 1.5, phases: { 'react.Details': 1.5 } });
  });

  it('reads a frame with no editor block at all', () => {
    const capture = captureOf([sample()]);
    delete capture.frames[0].editor;
    const read = roundTrip(capture);
    expect(read.frames[0].editor).toBeUndefined();
    expect(frameProfileOf(read.frames[0]).cpuMs).toBeGreaterThan(0);
  });
});
