// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  smoke-retry.test.ts — when a launch is repeated and when it stands.
 *
 * The property a retry policy can destroy: a game that genuinely draws nothing
 * must still fail, and it must fail on the first launch with no second one to
 * hide it. The rest is about not reporting an emulator's black frame as a
 * verdict on the game, and about "this machine could not judge" never again
 * counting as a pass.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a .mjs tool module, typed by its own JSDoc
import { worthAnotherLaunch, verdictOf, exitCodeFor, unjudgedReason } from '../lib/smokeRetry.mjs';

/** A run of the shape the check produces: `wanted` frames asked for, `colors` seen. */
const run = (o: Partial<{ countColors: boolean, frames: number, wanted: number, colors: number, minColors: number }>) =>
    ({ countColors: true, frames: 30, wanted: 30, colors: 8, minColors: 2, ...o });

const flat = { ok: false, why: 'the frame is 1 flat color after 120 frame(s)' };
const drew = { ok: true, colors: 8 };
const slow = { ok: false, undetermined: true, unjudged: 'too slow to judge here — 10 frame(s) before the capture' };

describe('what earns a second launch', () => {
    it('repeats a frame of one flat colour', () => {
        expect(worthAnotherLaunch(flat)).toBe(true);
    });

    it('repeats a run that never reached the frame it is judged at', () => {
        expect(worthAnotherLaunch(slow)).toBe(true);
    });

    // The whole point of the policy: these are the ones that must not be given a
    // second chance, or a broken build becomes a slow green one.
    it('does not repeat a crash, a launch that never reported ready, or a boot error', () => {
        expect(worthAnotherLaunch({ ok: false, why: 'never reported ready' })).toBe(false);
        expect(worthAnotherLaunch({ ok: false, why: 'reported ready, then drew no frame at all' })).toBe(false);
        expect(worthAnotherLaunch({ ok: false, why: 'ERROR [asset] texture 4 failed to upload' })).toBe(false);
        expect(worthAnotherLaunch({ ok: false, why: 'after an activity recreate: ERROR [js] undefined' })).toBe(false);
    });

    it('does not repeat a game a dialog was covering — that retry is already spent', () => {
        expect(worthAnotherLaunch({ ok: false, why: 'the game was not on screen — a dialog has focus', offScreen: 'a dialog has focus' })).toBe(false);
    });

    it('leaves a run that drew alone', () => {
        expect(worthAnotherLaunch(drew)).toBe(false);
    });
});

describe('what counts as having judged the frame', () => {
    // The question is "did it draw", not "did it reach frame 30". lighting-2d
    // takes 90s to reach 10 frames on a software rasteriser and has 1322 colours
    // in the first of them; failing the run for that reports the emulator.
    it('a picture with content is an answer, whatever frame it stopped at', () => {
        expect(unjudgedReason(run({ frames: 10, colors: 1322 }))).toBeNull();
    });

    it('a flat frame short of the asked-for frame is not an answer', () => {
        expect(unjudgedReason(run({ frames: 10, colors: 1 }))).toMatch(/too slow to judge/);
    });

    it('a flat frame that DID reach the asked-for frame is a verdict, not an excuse', () => {
        expect(unjudgedReason(run({ frames: 30, colors: 1 }))).toBeNull();
    });

    it('no frame at all is its own failure, never unanswered', () => {
        expect(unjudgedReason(run({ frames: 0, colors: 1 }))).toBeNull();
    });

    it('says nothing when the frame is not being judged', () => {
        expect(unjudgedReason(run({ countColors: false, frames: 10, colors: 1 }))).toBeNull();
    });
});

describe('three states, not two', () => {
    it('separates unanswered from passed', () => {
        expect(verdictOf(drew)).toBe('pass');
        expect(verdictOf(flat)).toBe('fail');
        expect(verdictOf(slow)).toBe('undetermined');
    });

    // 0.59.0 shipped a black audio-demo because this returned 0.
    it('exits 2 when a run went unanswered and nothing broke', () => {
        expect(exitCodeFor([drew, slow])).toBe(2);
    });

    it('exits 1 when something broke, even beside an unanswered one', () => {
        expect(exitCodeFor([flat, slow])).toBe(1);
    });

    it('exits 0 only when every example was asked and answered', () => {
        expect(exitCodeFor([drew, drew])).toBe(0);
    });

    it('does not fail the run for an example already recorded as broken', () => {
        expect(exitCodeFor([{ ...flat, name: 'known' }, drew], (r) => (r as { name?: string }).name === 'known')).toBe(0);
    });
});
