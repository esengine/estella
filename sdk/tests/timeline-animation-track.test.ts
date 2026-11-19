// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Animation tracks: clips ease in over what the rig holds, crossfade where they overlap, hold their last frame
 *        when asked, and leave the rig alone between clips. Over a mock world with a real Transform.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, getComponent } from '../src/ecs/component';
import { resolveChildEntity } from '../src/ecs/childPath';
import { animationClipWeights, clipLocalTime, sampleAnimationTracks } from '../src/timeline/timelineAnimation';
import { WrapMode, TrackType, type AnimationTrack, type TimelineAsset } from '../src/timeline/TimelineTypes';
import type { SampleDeps } from '../src/timeline/TimelineEvaluator';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';
import { Animator } from '../src/animation/Animator';

const hold = (value: number, duration = 1): TimelineAsset => ({
    version: '1.3', type: 'timeline', duration, wrapMode: WrapMode.Once,
    tracks: [{ type: TrackType.Property, name: '', childPath: 'Arm', component: 'Transform', channels: [
        { property: 'position.x', keyframes: [{ time: 0, value, inTangent: 0, outTangent: 0 }, { time: duration, value, inTangent: 0, outTangent: 0 }] },
    ] }],
});
const ramp: TimelineAsset = {
    version: '1.3', type: 'timeline', duration: 2, wrapMode: WrapMode.Once,
    tracks: [{ type: TrackType.Property, name: '', childPath: 'Arm', component: 'Transform', channels: [
        { property: 'position.x', keyframes: [{ time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: 1 as never }, { time: 2, value: 200, inTangent: 0, outTangent: 0 }] },
    ] }],
};
const clip = (over: Partial<AnimationTrack['clips'][number]>) => ({ start: 0, duration: 1, clip: '', clipIn: 0, speed: 1, loop: false, easeIn: 0, easeOut: 0, ...over });

describe('animationClipWeights', () => {
    const track: AnimationTrack = { type: TrackType.Animation, name: '', childPath: '', hold: false, clips: [
        clip({ start: 0, duration: 2, clip: 'a', easeIn: 0.5 }),
        clip({ start: 1.5, duration: 2, clip: 'b', easeOut: 1 }),
    ] };
    const len = () => 0;
    it('eases a clip in from nothing, and crossfades two over their overlap', () => {
        expect(animationClipWeights(track, 0.25, len)).toEqual([{ index: 0, weight: 0.5, local: 0.25 }]);
        expect(animationClipWeights(track, 1, len)).toEqual([{ index: 0, weight: 1, local: 1 }]);
        const mid = animationClipWeights(track, 1.75, len);
        expect(mid.map((w) => w.weight)).toEqual([0.5, 0.5]);
        expect(animationClipWeights(track, 3, len)).toEqual([{ index: 1, weight: 0.5, local: 1.5 }]);
        expect(animationClipWeights(track, 4, len)).toEqual([]);
    });
    it('holds the last clip’s final frame after it when asked', () => {
        expect(animationClipWeights({ ...track, hold: true }, 9, () => 1.2)).toEqual([{ index: 1, weight: 1, local: 1.2 }]);
    });
    it('starts a clip partway into its animation, at its speed, looping or holding at its end', () => {
        expect(clipLocalTime(clip({ start: 1, clipIn: 0.5, speed: 2 }), 1.5, 0)).toBe(1.5);
        expect(clipLocalTime(clip({ start: 0, loop: true }), 2.5, 1)).toBeCloseTo(0.5, 9);
        expect(clipLocalTime(clip({ start: 0 }), 2.5, 1)).toBe(1);
    });
});

describe('sampleAnimationTracks', () => {
    let world: World;
    let rig: Entity, arm: Entity;
    beforeEach(() => {
        world = new World();
        const mod = createMockModule();
        world.connectCpp(mod.getRegistry(), mod);
        rig = world.spawn('rig');
        world.insert(rig, Transform, {});
        arm = world.spawn('Arm');
        world.insert(arm, Transform, {});
        world.setParent(arm, rig);
    });
    const deps = (): SampleDeps => ({ world: world as never, getComponent, resolveChild: (r, p) => resolveChildEntity(world, r, p) });
    const anims: Record<string, TimelineAsset> = { a: hold(10, 2), b: hold(50, 2), r: ramp };
    const lookup = (ref: string) => anims[ref];
    const x = () => world.get(arm, Transform).position.x;
    const timeline = (track: Partial<AnimationTrack>): TimelineAsset => ({
        version: '1.3', type: 'timeline', duration: 5, wrapMode: WrapMode.Once,
        tracks: [{ type: TrackType.Animation, name: '', childPath: '', hold: false, clips: [], ...track } as AnimationTrack],
    });

    it('blends an easing clip with what the rig holds, then plays it whole, and crossfades into the next', () => {
        const tl = timeline({ clips: [clip({ start: 0, duration: 2, clip: 'a', easeIn: 0.5 }), clip({ start: 1.5, duration: 2, clip: 'b' })] });
        sampleAnimationTracks(tl, 0.25, rig, deps(), lookup);
        expect(x()).toBeCloseTo(5, 6);
        sampleAnimationTracks(tl, 1, rig, deps(), lookup);
        expect(x()).toBeCloseTo(10, 6);
        sampleAnimationTracks(tl, 1.75, rig, deps(), lookup);
        expect(x()).toBeCloseTo(30, 6);
    });

    it('leaves the rig to its own animation where no clip plays, unless the last one holds', () => {
        const tl = timeline({ clips: [clip({ start: 0, duration: 1, clip: 'b' })] });
        world.insert(arm, Transform, { position: { x: 7, y: 0, z: 0 } });
        sampleAnimationTracks(tl, 3, rig, deps(), lookup);
        expect(x()).toBe(7);
        sampleAnimationTracks(timeline({ hold: true, clips: [clip({ start: 0, duration: 1, clip: 'r' })] }), 3, rig, deps(), lookup);
        // The ramp's last frame of its 1s clip: 1s into a 2s ramp to 200.
        expect(x()).toBeCloseTo(100, 6);
    });

    it('eases in from the rig’s rest pose frame after frame, not from what the track wrote the frame before', () => {
        const tl = timeline({ clips: [clip({ start: 0, duration: 2, clip: 'a', easeIn: 0.5 })] });
        sampleAnimationTracks(tl, 0.25, rig, deps(), lookup);
        sampleAnimationTracks(tl, 0.25, rig, deps(), lookup);
        sampleAnimationTracks(tl, 0.25, rig, deps(), lookup);
        expect(x()).toBeCloseTo(5, 6);
    });

    it('blends over the pose an Animator gave the rig this frame', () => {
        world.insert(rig, Animator, { enabled: true });
        const tl = timeline({ clips: [clip({ start: 0, duration: 2, clip: 'a', easeIn: 0.5 })] });
        // As the Animator would have posed it before the timeline runs.
        world.insert(arm, Transform, { position: { x: 40, y: 0, z: 0 } });
        sampleAnimationTracks(tl, 0.25, rig, deps(), lookup);
        expect(x()).toBeCloseTo(25, 6);
    });

    it('plays from Clip In at the clip’s speed', () => {
        sampleAnimationTracks(timeline({ clips: [clip({ start: 1, duration: 2, clip: 'r', clipIn: 0.5, speed: 0.5 })] }), 2, rig, deps(), lookup);
        // 0.5 + 1 * 0.5 = 1s into the ramp.
        expect(x()).toBeCloseTo(100, 6);
    });
});
