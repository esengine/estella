// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  dead-gpu.test.ts — when a measurement counts and when it is retaken.
 *
 * The property that matters is the one a retry policy can destroy: a game that
 * genuinely draws nothing must still fail, on the first attempt, with no retry to
 * hide it. Everything else here is about not reporting a runner's dead GPU as a
 * verdict on the game.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a .mjs tool module, typed by its own JSDoc
import { retryOnDeadGpu, gpuNeverCameUp, deadGpuVerdict } from '../lib/deadGpu.mjs';

const DEAD = 'Exiting GPU process due to errors during initialization';
const BLANK = 'painted=true live=false errors=0';

/** Drive the policy over a scripted sequence of attempt outputs; `null` = success. */
function run(outputs: Array<string | null>) {
    let attempts = 0;
    const notes: boolean[] = [];
    const result = retryOnDeadGpu(
        () => {
            const out = outputs[Math.min(attempts++, outputs.length - 1)];
            return { ok: out === null, output: out ?? '' };
        },
        (died: boolean) => notes.push(died),
        0,   // no backoff: there is no GPU process to wait for here
    );
    return { ...result, attempts, notes };
}

/** The same, for runs that report whether they reached a verdict. */
type Attempt = { ok: boolean; output?: string; measured?: boolean; drew?: boolean };
function runReporting(attempts_: Attempt[]) {
    let attempts = 0;
    const notes: boolean[] = [];
    const result = retryOnDeadGpu(
        () => ({ output: '', ...attempts_[Math.min(attempts++, attempts_.length - 1)] }),
        (noVerdict: boolean) => notes.push(noVerdict),
        0,
    );
    return { ...result, attempts, notes };
}

describe('gpuNeverCameUp', () => {
    it('recognises the three ways a runner says it has no GPU', () => {
        expect(gpuNeverCameUp(DEAD)).toBe(true);
        expect(gpuNeverCameUp('GPU device lost\nFailed to create framebuffer')).toBe(true);
        expect(gpuNeverCameUp('WebGL2 is not available')).toBe(true);
    });

    it('does not read a verdict about pixels as one about the GPU', () => {
        expect(gpuNeverCameUp(BLANK)).toBe(false);
        // Device loss alone is a scene some gates drive on purpose; only paired
        // with a framebuffer that could not be made is it a runner with no GPU.
        expect(gpuNeverCameUp('GPU device lost')).toBe(false);
    });
});

describe('retryOnDeadGpu', () => {
    it('a game that draws nothing fails on the first attempt', () => {
        // The whole point: no retry may stand between a black frame and a red gate.
        const r = run([BLANK]);
        expect(r.ok).toBe(false);
        expect(r.attempts).toBe(1);
        expect(r.notes).toEqual([]);
    });

    it('takes one measurement when the GPU is up', () => {
        const r = run([null]);
        expect(r.ok).toBe(true);
        expect(r.attempts).toBe(1);
        expect(r.retried).toBe(false);
    });

    it('measures again when the GPU died before it drew', () => {
        const r = run([DEAD, null]);
        expect(r.ok).toBe(true);
        expect(r.attempts).toBe(2);
        expect(r.notes).toEqual([true]);
    });

    it('measures again for a blank frame that FOLLOWS a death in the chain', () => {
        // The case that made this necessary: a GPU process that dies and restarts
        // leaves the next launch on a context-lost renderer, which paints a blank
        // frame and prints nothing about why.
        const r = run([DEAD, BLANK, null]);
        expect(r.ok).toBe(true);
        expect(r.attempts).toBe(3);
        expect(r.notes).toEqual([true, false]);
    });

    it('reads a lost device that then fails to make TEXTURES', () => {
        // Verbatim from the runner, the day the second clause was found to only
        // know about framebuffers.
        const real = [
            '[ERROR] GPU device lost: context-lost [backend=WebGL2, vendor=Google Inc.]',
            '[ERROR] Texture::initialize: createTexture failed for 70x70',
            '[ERROR] Failed to create texture from spec',
        ].join('\n');
        expect(gpuNeverCameUp(real)).toBe(true);
    });

    it('words the give-up once, for both runners', () => {
        // The two of them each had their own sentence for it, and one of them
        // blamed the game — the failure this file exists to keep apart.
        expect(deadGpuVerdict('the game')).toContain('says nothing about the game');
        expect(deadGpuVerdict('the scene')).toContain('never came up');
    });

    // The runner this policy runs on prints the dead-GPU line on runs that then
    // succeed, so text alone made every failure look like an outage: one job
    // spent 71 retries and never named the scene that broke.
    it('a run that reached a verdict is not retried, whatever the log says', () => {
        const r = runReporting([{ ok: false, output: DEAD, measured: true, drew: true }]);
        expect(r.ok).toBe(false);
        expect(r.attempts).toBe(1);
        expect(r.notes).toEqual([]);
    });

    it('retries a run that reached no verdict, whatever the log says', () => {
        // Nothing in this output mentions a GPU; the run simply never got far
        // enough to judge anything, which is not a verdict about the subject.
        const r = runReporting([
            { ok: false, output: 'launch timed out', measured: false },
            { ok: true },
        ]);
        expect(r.ok).toBe(true);
        expect(r.attempts).toBe(2);
        expect(r.notes).toEqual([true]);
    });

    it('still retries a blank frame that follows a run with no verdict', () => {
        const r = runReporting([
            { ok: false, measured: false },
            { ok: false, measured: true, drew: false },
            { ok: true },
        ]);
        expect(r.ok).toBe(true);
        expect(r.attempts).toBe(3);
        expect(r.notes).toEqual([true, false]);
    });

    it('stops retrying once a run draws, even after an outage', () => {
        // A drawn frame that fails its assertion is the subject's own failure;
        // the outage is over and further attempts only hide it.
        const r = runReporting([
            { ok: false, measured: false },
            { ok: false, measured: true, drew: true },
        ]);
        expect(r.ok).toBe(false);
        expect(r.attempts).toBe(2);
        expect(r.gpuDied).toBeUndefined();
    });

    it('gives up at the cap and says the GPU is why', () => {
        const r = run([DEAD]);
        expect(r.ok).toBe(false);
        expect(r.attempts).toBe(6);
        expect(r.gpuDied).toBe(true);
    });
});
