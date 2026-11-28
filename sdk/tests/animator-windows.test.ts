// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a custom event with a duration is a window the animator reports while
 * its playhead is inside it - one shorter than a frame included - and only for the
 * motion that is playing, so a clip left early leaves its window shut. Each opening
 * is its own, so two attacks back to back are two.
 */
import { describe, it, expect, vi } from 'vitest';
import { Animator, AnimatorControllerAPI, type AnimatorData, type AnimatorControllerDef } from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { WrapMode, TrackType, type TimelineAsset, type CustomEvent } from '../src/timeline/TimelineTypes';
import { collectCustomWindows } from '../src/timeline/timelineEvents';
import type { MotionWindow } from '../src/animation';
import type { Entity } from '../src/types';

const E = 1 as Entity;

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        insert(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
        set(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        tryGet(e: number, c: unknown) { return mapOf(c).get(e) ?? null; },
        update(e: number, c: unknown, edit: (d: any) => void) {
            const d = mapOf(c).get(e);
            edit(d); mapOf(c).set(e, d);
        },
        remove(e: number, c: unknown) { mapOf(c).delete(e); },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

/** A clip of `duration` seconds that only declares events. */
function clip(events: CustomEvent[], duration = 1, wrapMode: WrapMode = WrapMode.Once): TimelineAsset {
    return {
        version: '1.2', type: 'timeline', duration, wrapMode,
        tracks: [{ type: TrackType.CustomEvent, name: 'events', childPath: '', events }],
    } as TimelineAsset;
}

const win = (name: string, time: number, duration: number): CustomEvent => ({ name, time, duration, payload: {} });

/** One state playing `clipName`; Attack -> Attack2 when `next` is set, with `fade` seconds of crossfade. */
function controller(timeline: TimelineAPI, fade = 0) {
    const ctrl = new AnimatorControllerAPI();
    const driver = createTimelineMotionDriver(timeline);
    ctrl.registerMotionDriver(TIMELINE_MOTION, driver);
    const def: AnimatorControllerDef = {
        parameters: [{ name: 'next', type: 'bool', default: false }],
        initialState: 'Attack',
        states: [
            {
                name: 'Attack',
                motion: { kind: TIMELINE_MOTION, clip: 'a.estimeline' },
                transitions: [{ to: 'Attack2', conditions: [{ param: 'next', op: 'true' }], duration: fade }],
            },
            { name: 'Attack2', motion: { kind: TIMELINE_MOTION, clip: 'b.estimeline' }, transitions: [] },
        ],
    };
    ctrl.registerController('fight', def);
    return { ctrl, def, driver };
}

function rig(a: TimelineAsset, b: TimelineAsset = clip([]), fade = 0) {
    const timeline = new TimelineAPI();
    timeline.registerAsset('a.estimeline', a);
    timeline.registerAsset('b.estimeline', b);
    const clock = controller(timeline, fade);
    const world = makeWorld();
    world.insert(E, Animator, { controller: 'fight', currentState: '', enabled: true } as AnimatorData);
    return { ...clock, world };
}

const open = (ctrl: AnimatorControllerAPI) => ctrl.windowsOf(E).map((w) => w.name);

describe('an animator window', () => {
    it('is open while the playhead is inside it, and not before or after', () => {
        const { ctrl, world } = rig(clip([win('attack-active', 0.2, 0.3)]));
        ctrl.update(world, 0);          // enters at 0
        expect(open(ctrl)).toEqual([]);
        ctrl.update(world, 0.25);       // 0 -> 0.25
        expect(open(ctrl)).toEqual(['attack-active']);
        ctrl.update(world, 0.2);        // 0.25 -> 0.45
        expect(ctrl.openWindow(E, 'attack-active')).not.toBeNull();
        ctrl.update(world, 0.1);        // 0.45 -> 0.55: it closed at 0.5 inside this frame, so it was open in it
        expect(open(ctrl)).toEqual(['attack-active']);
        ctrl.update(world, 0.1);        // 0.55 -> 0.65
        expect(open(ctrl)).toEqual([]);
    });

    it('is reported on the frame that passed over it when it is shorter than the frame', () => {
        const { ctrl, world } = rig(clip([win('attack-active', 0.30, 0.01)]));
        ctrl.update(world, 0);
        ctrl.update(world, 0.25);       // 0 -> 0.25: not yet
        expect(open(ctrl)).toEqual([]);
        ctrl.update(world, 0.1);        // 0.25 -> 0.35 covers 0.30..0.31 whole
        expect(open(ctrl)).toEqual(['attack-active']);
        ctrl.update(world, 0.1);
        expect(open(ctrl)).toEqual([]);
    });

    it('keeps one id while it stays open', () => {
        const { ctrl, world } = rig(clip([win('attack-active', 0, 0.5)]));
        ctrl.update(world, 0);
        const first = ctrl.openWindow(E, 'attack-active')!.id;
        ctrl.update(world, 0.1);
        ctrl.update(world, 0.1);
        expect(ctrl.openWindow(E, 'attack-active')!.id).toBe(first);
    });

    it('is a new opening each lap of a looping clip', () => {
        const { ctrl, world } = rig(clip([win('attack-active', 0.1, 0.2)], 1, WrapMode.Loop));
        ctrl.update(world, 0);
        ctrl.update(world, 0.2);
        const lap1 = ctrl.openWindow(E, 'attack-active')!.id;
        ctrl.update(world, 0.2);        // 0.2 -> 0.4: it closed at 0.3 inside this frame
        ctrl.update(world, 0.3);        // 0.4 -> 0.7: shut
        expect(open(ctrl)).toEqual([]);
        ctrl.update(world, 0.5);        // 0.7 -> 1.2 = 0.2 of lap two
        const lap2 = ctrl.openWindow(E, 'attack-active')!.id;
        expect(lap2).not.toBe(lap1);
    });

    it('is a new opening when the next state opens one with no frame between', () => {
        const { ctrl, world } = rig(clip([win('attack-active', 0, 1)]), clip([win('attack-active', 0, 1)]));
        ctrl.update(world, 0);
        ctrl.update(world, 0.2);
        const first = ctrl.openWindow(E, 'attack-active')!.id;
        ctrl.setBool(E, 'next', true);
        ctrl.update(world, 0.1);        // the combo's second swing begins this frame
        const second = ctrl.openWindow(E, 'attack-active');
        expect(second).not.toBeNull();
        expect(second!.id).not.toBe(first);
    });

    it('shuts the moment its clip is left, even while the clip still fades out', () => {
        const { ctrl, world } = rig(clip([win('attack-active', 0, 1)]), clip([]), 0.5);
        ctrl.update(world, 0);
        ctrl.update(world, 0.2);
        expect(open(ctrl)).toEqual(['attack-active']);
        ctrl.setBool(E, 'next', true);
        ctrl.update(world, 0.05);       // fading into Attack2: Attack is still on screen
        expect(open(ctrl)).toEqual([]);
    });

    it('is gone once its entity is no longer animated', () => {
        const { ctrl, world } = rig(clip([win('attack-active', 0, 1)]));
        ctrl.update(world, 0);
        expect(open(ctrl)).toEqual(['attack-active']);
        world.insert(E, Animator, { ...(world.get(E, Animator) as AnimatorData), enabled: false });
        ctrl.update(world, 0.1);
        expect(open(ctrl)).toEqual([]);
    });

    it('still posts its event once where it opens', () => {
        const { ctrl, world } = rig(clip([win('attack-active', 0.2, 0.3)]));
        const posted: string[] = [];
        const sink = { send: (e: { name: string }) => posted.push(e.name) };
        ctrl.update(world, 0, sink);
        ctrl.update(world, 0.25, sink);
        ctrl.update(world, 0.2, sink);
        expect(posted).toEqual(['attack-active']);
    });

    it('samples only published windows when a transition never reaches its window conditions', () => {
        const { ctrl, def, driver, world } = rig(clip([win('attack-active', 0.1, 0.3)]));
        def.states[0]!.transitions[0]!.conditions.push({ param: 'attack-active', op: 'window' });
        ctrl.update(world, 0);
        const windows = vi.spyOn(driver, 'windows');

        ctrl.update(world, 0.2);
        expect(open(ctrl)).toEqual(['attack-active']);
        expect(windows).toHaveBeenCalledOnce();
    });

    it('shares a window sample across checked conditions and publishes the destination windows separately', () => {
        const { ctrl, def, driver, world } = rig(clip([win('attack-active', 0.1, 0.3), win('combo', 0.15, 0.2)]),
            clip([win('follow-through', 0, 0.3)]));
        def.states[0]!.transitions[0]!.conditions.push({ param: 'attack-active', op: 'window' }, { param: 'combo', op: 'window' });
        ctrl.update(world, 0);
        ctrl.setBool(E, 'next', true);
        const windows = vi.spyOn(driver, 'windows');

        ctrl.update(world, 0.2);
        expect(world.get(E, Animator).currentState).toBe('Attack2');
        expect(open(ctrl)).toEqual(['follow-through']);
        expect(windows.mock.calls.map(([, motion]) => motion.clip)).toEqual(['a.estimeline', 'b.estimeline']);
    });
});

describe('a clip window in clip time', () => {
    const asset = clip([win('w', 0.5, 0.25)]);
    const found = (from: number, to: number): string[] => {
        const out: MotionWindow[] = [];
        collectCustomWindows(asset, [{ from, to, inclusiveStart: false }], out);
        return out.map((w) => w.name);
    };

    it('is half open: a run that only reaches its closing edge does not open it', () => {
        expect(found(0.75, 0.9)).toEqual([]);
        expect(found(0.4, 0.5)).toEqual(['w']);
    });

    it('stays open under a playhead standing still inside it, as a paused clock is', () => {
        expect(found(0.6, 0.6)).toEqual(['w']);
    });

    it('is reached by a playhead running backwards through it', () => {
        expect(found(0.9, 0.55)).toEqual(['w']);
    });
});

describe('a custom event read from disk', () => {
    const read = (duration: unknown) => (parseTimelineAsset({
        version: '1.2', type: 'timeline', duration: 1, wrapMode: 'once',
        tracks: [{ type: 'customEvent', name: 'e', childPath: '', events: [{ time: 0.1, name: 'w', duration }] }],
    }).tracks[0] as { events: CustomEvent[] }).events[0]!.duration;

    it('keeps a stretch that is one, and reads anything else as a moment', () => {
        expect(read(0.25)).toBe(0.25);
        expect(read(0)).toBeUndefined();
        expect(read(-1)).toBeUndefined();
        expect(read('long')).toBeUndefined();
        expect(read(undefined)).toBeUndefined();
    });
});
