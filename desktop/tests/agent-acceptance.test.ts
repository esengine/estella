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
  criteriaProblem, evaluate, failureReport, markBaseline, verdictOf, MAX_CRITERIA,
} from '../electron/agent/acceptance';
import type { Criterion, KernelDeps } from '../electron/agent/types';

/** A driver whose editor is clean and whose game answers `probe` with `answer`. */
function fakeDriver(over: {
  diagnostics?: unknown[];
  scripts?: unknown;
  playing?: boolean;
  probe?: (code: string) => unknown;
  standing?: Criterion[];
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
  return { driver, standing: () => over.standing ?? [] } as unknown as KernelDeps;
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
    expect(out.results.every((r) => r.owner !== 'turn')).toBe(true);
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
    expect(out.results.find((r) => r.owner === 'turn')).toMatchObject({ state: 'unsettled' });
    expect(out.results.find((r) => r.owner === 'turn')?.detail).toContain('not running');
  });

  // Owned by a person, and reported as owned — never quietly counted as passed,
  // which is the failure `manual` exists to prevent.
  it('reports a claim only a person can settle as theirs', async () => {
    const deps = fakeDriver();
    const out = await evaluate(deps, [{ says: 'it reads at 1080p', manual: 'a judgement about legibility' }]);
    expect(out.verdict).toBe('unverified');
    expect(out.results.find((r) => r.owner === 'turn')?.detail).toContain('only a person');
  });

  // Passing on the machine-checkable half is what made `manual` the cheap way
  // out: declare the hard claim as theirs, grade it yourself in the closing
  // paragraph, and the verdict still reads passed with nobody ever asked.
  it('does not pass while a claim is still waiting on a person', async () => {
    const deps = fakeDriver({ probe: () => true });
    const out = await evaluate(deps, [
      { says: 'the bar empties', probe: 'true' },
      { says: 'it reads at 1080p', manual: 'a judgement about legibility' },
    ]);
    expect(out.verdict).toBe('unverified');
  });

  it('passes once the person has settled theirs', () => {
    expect(verdictOf([
      { says: 'the bar empties', probe: 'true', state: 'held', owner: 'turn' },
      { says: 'it reads at 1080p', manual: 'legibility', state: 'held', owner: 'turn' },
    ])).toBe('passed');
  });

  it('fails when the person says it did not hold', () => {
    expect(verdictOf([
      { says: 'the bar empties', probe: 'true', state: 'held', owner: 'turn' },
      { says: 'it reads at 1080p', manual: 'legibility', state: 'broke', owner: 'turn' },
    ])).toBe('failed');
  });
});

/**
 * A claim that was already true before the work is a guard on what already
 * worked. It is worth keeping and it can still break — what it cannot be is the
 * thing that says this turn achieved something.
 */
describe('a claim that already held when it was declared', () => {
  const guard = { says: 'the player has a collider', probe: 'true' };

  it('is marked at declaration, while there is still time to claim something else', async () => {
    const deps = fakeDriver({ probe: () => true });
    expect(await markBaseline(deps, [guard])).toEqual([{ ...guard, heldBefore: true }]);
  });

  it('claims nothing either way when the game is not up', async () => {
    const deps = fakeDriver({ playing: false, probe: () => true });
    expect(await markBaseline(deps, [guard])).toEqual([{ ...guard }]);
  });

  it('leaves a claim that is false right now alone', async () => {
    const deps = fakeDriver({ probe: () => false });
    expect(await markBaseline(deps, [guard])).toEqual([{ ...guard }]);
  });

  it('does not carry a turn to passed on its own', async () => {
    const deps = fakeDriver({ probe: () => true });
    const out = await evaluate(deps, [{ ...guard, heldBefore: true }]);
    expect(out.results.find((r) => r.owner === 'turn')?.state).toBe('held');
    expect(out.verdict).toBe('unverified');
  });

  it('still fails the turn when it breaks', async () => {
    const deps = fakeDriver({ probe: () => false });
    const out = await evaluate(deps, [{ ...guard, heldBefore: true }]);
    expect(out.verdict).toBe('failed');
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


/**
 * The project's own claims — the ones a turn did not write, cannot weaken and
 * cannot retract. This is what makes the verdict worth reading over a long run:
 * the bar stops being whatever the model thought to set that turn.
 */
describe("the project's standing claims", () => {
  const standing = [{ says: 'the player can always reach the exit', probe: 'reachable' }];

  it('fails a turn that broke one, however well its own claims did', async () => {
    const deps = fakeDriver({ standing, probe: (code) => code !== 'reachable' });
    const out = await evaluate(deps, [{ says: 'the new door opens', probe: 'door' }]);
    expect(out.verdict).toBe('failed');
    expect(out.results.find((r) => r.owner === 'project')).toMatchObject({ state: 'broke' });
  });

  // Not broken is not done. A run measured only against standing claims would
  // pass by changing nothing at all.
  it('does not pass a turn on standing claims alone', async () => {
    const deps = fakeDriver({ standing, probe: () => true });
    expect((await evaluate(deps, [])).verdict).toBe('unverified');
  });

  it("names them as the project's, so a reader knows who set the bar", async () => {
    const deps = fakeDriver({ standing, probe: () => true });
    const out = await evaluate(deps, [{ says: 'the new door opens', probe: 'door' }]);
    expect(out.results.map((r) => r.owner)).toEqual(['editor', 'editor', 'project', 'turn']);
    expect(out.verdict).toBe('passed');
  });

  it('tells the model about a standing claim it broke', async () => {
    const deps = fakeDriver({ standing, probe: () => false });
    const report = failureReport(await evaluate(deps, []))!;
    expect(report).toContain('the player can always reach the exit');
  });

  // Kept whole, because keeping one means writing it into the project exactly
  // as it was run — a claim that lost its probe on the way is not keepable.
  it('carries the probe through, so a proven claim can be kept', async () => {
    const deps = fakeDriver({ probe: () => true });
    const out = await evaluate(deps, [{ says: 'the bar starts full', probe: 'hp === 100' }]);
    expect(out.results.find((r) => r.owner === 'turn')).toMatchObject({
      says: 'the bar starts full', probe: 'hp === 100', state: 'held',
    });
  });
});
