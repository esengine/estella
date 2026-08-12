// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The verdict on a turn's work, and the rule that a claim must name what
 *        settles it (tools/releaseGate.mjs, one level down).
 *
 * The property under test is the one the whole thing exists for: the verdict
 * comes from the project, and no answer the model could write changes it.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  criteriaProblem, evaluate, failureReport, MAX_CRITERIA,
} from '../electron/agent/acceptance';
import type { KernelDeps } from '../electron/agent/types';

/** A driver whose editor is clean and whose game answers `probe` with `answer`. */
function fakeDriver(over: {
  diagnostics?: unknown[];
  scripts?: unknown;
  playing?: boolean;
  probe?: (code: string) => unknown;
} = {}) {
  const driver = vi.fn(async (method: string) => {
    if (method === 'getDiagnostics') return over.diagnostics ?? [];
    if (method === 'playState') return { playing: over.playing ?? true, ready: true };
    return null;
  }) as unknown as KernelDeps['driver'];
  (driver as { op: unknown }).op = vi.fn(async (op: string, input?: Record<string, unknown>) => {
    if (op === 'check_scripts') return over.scripts ?? { diagnostics: [] };
    if (op === 'play_probe') {
      const value = over.probe?.(String(input?.code)) ?? false;
      if (value instanceof Error) throw value;
      return { content: [{ type: 'text', text: JSON.stringify(value) }] };
    }
    return null;
  });
  (driver as { js: unknown }).js = vi.fn(async () => null);
  return { driver } as unknown as KernelDeps;
}

describe('a claim has to name what settles it', () => {
  it('refuses a claim with nothing that settles it', () => {
    expect(criteriaProblem([{ says: 'it feels good' }]))
      .toMatch(/names nothing that settles it/);
  });

  it('refuses a claim that names two things', () => {
    expect(criteriaProblem([{ says: 'x', probe: 'true', manual: 'because' }]))
      .toMatch(/one criterion, one thing that settles it/);
  });

  it('refuses a claim that says nothing', () => {
    expect(criteriaProblem([{ probe: 'true' }])).toMatch(/needs `says`/);
    expect(criteriaProblem([{ says: '  ', probe: 'true' }])).toMatch(/needs `says`/);
  });

  it('refuses an empty list — declaring none is not declaring', () => {
    expect(criteriaProblem([])).toMatch(/at least one/);
    expect(criteriaProblem(undefined)).toMatch(/at least one/);
  });

  it('refuses more than a person would read', () => {
    const many = Array.from({ length: MAX_CRITERIA + 1 }, (_, i) => ({ says: `c${i}`, probe: 'true' }));
    expect(criteriaProblem(many)).toMatch(/at most/);
  });

  it('accepts a probe, and accepts a reason only a person can judge', () => {
    expect(criteriaProblem([{ says: 'the bar empties', probe: 'true' }])).toBeNull();
    expect(criteriaProblem([{ says: 'it reads at 1080p', manual: 'a judgement about legibility' }])).toBeNull();
  });
});

describe('the verdict', () => {
  const held = { says: 'the bar starts full', probe: 'find("Health")[0].data.current === 100' };

  it('passes when every claim held', async () => {
    const deps = fakeDriver({ probe: () => true });
    const out = await evaluate(deps, [held]);
    expect(out.verdict).toBe('passed');
  });

  it('fails when a claim did not hold, and says what the probe answered', async () => {
    const deps = fakeDriver({ probe: () => 0 });
    const out = await evaluate(deps, [held]);
    expect(out.verdict).toBe('failed');
    expect(out.results.find((r) => r.says === held.says)?.detail).toContain('0');
  });

  it('fails when the probe threw', async () => {
    const deps = fakeDriver({ probe: () => new Error('Health is not a component') });
    const out = await evaluate(deps, [held]);
    expect(out.verdict).toBe('failed');
    expect(out.results.find((r) => r.says === held.says)?.detail).toContain('not a component');
  });

  // A turn that claimed nothing is not a turn that succeeded. This is the whole
  // point: the absence of a check is reported as an absence.
  it('is unverified when nothing was claimed', async () => {
    const out = await evaluate(fakeDriver(), []);
    expect(out.verdict).toBe('unverified');
  });

  // The editor's own checks can only ever fail a turn. A project with nothing
  // wrong is not a project where the work happened.
  it('does not pass a turn on the editor checks alone', async () => {
    const out = await evaluate(fakeDriver(), []);
    expect(out.results.every((r) => r.floor)).toBe(true);
    expect(out.results.some((r) => r.state === 'held')).toBe(true);
    expect(out.verdict).toBe('unverified');
  });

  it('fails a turn whose scene the editor flags, whatever it claimed', async () => {
    const deps = fakeDriver({
      probe: () => true,
      diagnostics: [{ entityName: 'HealthBar', problem: 'error', detail: 'texture is missing' }],
    });
    const out = await evaluate(deps, [held]);
    expect(out.verdict).toBe('failed');
    expect(failureReport(out)).toContain('texture is missing');
  });

  it('fails a turn whose scripts do not compile', async () => {
    const deps = fakeDriver({
      probe: () => true,
      scripts: { diagnostics: [{ file: 'src/HP.ts', line: 4, message: "Cannot find name 'foo'" }] },
    });
    expect((await evaluate(deps, [held])).verdict).toBe('failed');
  });

  // A warning is not a broken build, and failing turns on one teaches the
  // person to stop reading the verdict.
  it('does not fail on a script warning', async () => {
    const deps = fakeDriver({
      probe: () => true,
      scripts: { diagnostics: [{ file: 'src/HP.ts', line: 4, message: 'unused', category: 'warning' }] },
    });
    expect((await evaluate(deps, [held])).verdict).toBe('passed');
  });
});

describe('what nothing was in a position to answer', () => {
  it('leaves a probe unsettled when the game was not running', async () => {
    const deps = fakeDriver({ playing: false, probe: () => true });
    const out = await evaluate(deps, [{ says: 'the bar empties', probe: 'true' }]);
    expect(out.verdict).toBe('unverified');
    expect(out.results.find((r) => !r.floor)).toMatchObject({ state: 'unsettled' });
    expect(out.results.find((r) => !r.floor)?.detail).toContain('not running');
  });

  // Owned by a person, and reported as owned — never quietly counted as passed,
  // which is the failure `manual` exists to prevent.
  it('reports a claim only a person can settle as theirs', async () => {
    const deps = fakeDriver();
    const out = await evaluate(deps, [{ says: 'it reads at 1080p', manual: 'a judgement about legibility' }]);
    expect(out.verdict).toBe('unverified');
    expect(out.results.find((r) => !r.floor)?.detail).toContain('only a person');
  });

  it('still passes on the claims a machine could settle', async () => {
    const deps = fakeDriver({ probe: () => true });
    const out = await evaluate(deps, [
      { says: 'the bar empties', probe: 'true' },
      { says: 'it reads at 1080p', manual: 'a judgement about legibility' },
    ]);
    expect(out.verdict).toBe('passed');
  });
});

describe('what the model is told to fix', () => {
  it('is nothing when nothing broke', async () => {
    expect(failureReport(await evaluate(fakeDriver({ probe: () => true }), []))).toBeNull();
  });

  it('names each broken claim, and does not name the ones that held', async () => {
    const deps = fakeDriver({ probe: (code) => code.includes('good') });
    const out = await evaluate(deps, [
      { says: 'the good one', probe: 'good' },
      { says: 'the bad one', probe: 'bad' },
    ]);
    const report = failureReport(out)!;
    expect(report).toContain('the bad one');
    expect(report).not.toContain('the good one');
  });
});
