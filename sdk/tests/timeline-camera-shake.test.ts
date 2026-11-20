// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Camera shake tracks: a shake fired, at its force, as the playhead crosses it (on a loop seam too), handed to
 *        the drive's shake handler from the track's entity; saved and loaded as written; and the view at a time worked
 *        out at once for a scrubbing preview.
 */
import { describe, it, expect } from 'vitest';
import { advanceTimelineTS, createTimelineState } from '../src/timeline/TimelineDrive';
import { WrapMode, TrackType, type TimelineAsset, type CameraShakeTrack } from '../src/timeline/TimelineTypes';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { serializeTimelineToJson } from '../src/timeline/TimelineSerializer';
import type { SampleDeps } from '../src/timeline/TimelineEvaluator';
import type { Entity } from '../src/types';
import { timelineShakenPOV, TIMELINE_VIEW_SHAKE } from '../src/timeline/timelineCameraShake';
import { CameraImpulseListener, CameraImpulseSource } from '../src/camera/CameraImpulse';
import { Transform } from '../src/ecs/component';
import type { CameraPOV } from '../src/camera/CameraPlugin';

const ROOT = 1 as Entity;
const BLAST = 9 as Entity;
const asset = (wrapMode: WrapMode = WrapMode.Once): TimelineAsset => ({
    version: '1.3', type: 'timeline', duration: 1, wrapMode,
    tracks: [{ type: TrackType.CameraShake, name: '', childPath: 'Blast', shakes: [{ time: 0.5, force: 2 }, { time: 0.05, force: 0.5 }] }],
});
const deps: SampleDeps = {
    world: {} as SampleDeps['world'], getComponent: () => undefined,
    resolveChild: (root, path) => (path === 'Blast' ? BLAST : path ? null : root),
};

describe('camera shake tracks', () => {
    it('fires each shake from the track’s entity, at its force, as the playhead crosses it', () => {
        const s = createTimelineState();
        s.playing = true;
        const fired: [Entity, number][] = [];
        const onShake = (e: Entity, f: number) => { fired.push([e, f]); };
        advanceTimelineTS(asset(), ROOT, s, 0.3, { deps, onShake });
        expect(fired).toEqual([[BLAST, 0.5]]);
        advanceTimelineTS(asset(), ROOT, s, 0.3, { deps, onShake });
        expect(fired).toEqual([[BLAST, 0.5], [BLAST, 2]]);
        advanceTimelineTS(asset(), ROOT, s, 0.3, { deps, onShake });
        expect(fired).toHaveLength(2);
    });

    it('fires a shake just after the start again on every loop', () => {
        const s = createTimelineState(WrapMode.Loop);
        s.playing = true;
        const fired: number[] = [];
        for (let i = 0; i < 4; i++) advanceTimelineTS(asset(WrapMode.Loop), ROOT, s, 0.45, { deps, onShake: (_e, f) => fired.push(f) });
        // 0 → 1.8 s over two loops: 0.05 twice, 0.5 twice.
        expect(fired.filter((f) => f === 0.5)).toHaveLength(2);
        expect(fired.filter((f) => f === 2)).toHaveLength(2);
    });

    it('saves and loads its shakes', () => {
        const back = parseTimelineAsset(JSON.parse(serializeTimelineToJson(asset()))).tracks[0] as CameraShakeTrack;
        expect(back).toMatchObject({ type: 'cameraShake', childPath: 'Blast', shakes: [{ time: 0.5, force: 2 }, { time: 0.05, force: 0.5 }] });
    });
});

describe('the shaken view at a time (the Sequencer preview)', () => {
    const CAM = 5 as Entity;
    const pov: CameraPOV = {
        entity: CAM, isActive: true, x: 0, y: 0, z: 10, rotation: 0, projection: 1, orthoSize: 100, fov: 60, near: 0.1, far: 1000,
        viewport: { x: 0, y: 0, z: 1, w: 1 }, clearFlags: 0, priority: 0, pixelPerfect: false,
    } as CameraPOV;
    const worldOf = (parts: Map<unknown, Map<Entity, unknown>>) => ({
        valid: () => true,
        tryGet: (e: Entity, def: unknown) => parts.get(def)?.get(e) ?? null,
    });
    const shakeDeps = (parts: Map<unknown, Map<Entity, unknown>>) => ({ world: worldOf(parts), root: ROOT, resolveChild: deps.resolveChild });
    const one = (force = 1): TimelineAsset => ({ ...asset(), tracks: [{ type: TrackType.CameraShake, name: '', childPath: 'Blast', shakes: [{ time: 0.5, force }] }] });

    it('shakes the view where it is from a track with no impulse source, only while the shake lasts', () => {
        const d = shakeDeps(new Map());
        expect(timelineShakenPOV(one(), 0.4, pov, CAM, d)).toBe(pov);
        const during = timelineShakenPOV(one(), 0.5 + 0.13, pov, CAM, d);
        expect(Math.hypot(during.x, during.y)).toBeGreaterThan(0.5);
        // The same view for the same time, every time it is asked.
        expect(timelineShakenPOV(one(), 0.63, pov, CAM, d)).toEqual(during);
        expect(timelineShakenPOV(one(), 0.5 + TIMELINE_VIEW_SHAKE.duration + 0.01, pov, CAM, d)).toBe(pov);
        // Harder with more force.
        const harder = timelineShakenPOV(one(3), 0.63, pov, CAM, d);
        expect(Math.hypot(harder.x, harder.y)).toBeCloseTo(3 * Math.hypot(during.x, during.y), 6);
    });

    it('jolts a listening camera from an impulse source by its distance, and leaves a camera that does not listen', () => {
        const source = { amplitude: 20, rotation: 1, frequency: 8, attack: 0.02, sustain: 0.1, decay: 0.6, radius: 300, dissipation: 2000, propagationSpeed: 0, channels: 1, fire: false };
        const parts = new Map<unknown, Map<Entity, unknown>>([
            [CameraImpulseSource, new Map([[BLAST, source]])],
            [Transform, new Map([[BLAST, { worldPosition: { x: 0, y: 0, z: 0 } }]])],
        ]);
        expect(timelineShakenPOV(one(), 0.6, pov, CAM, shakeDeps(parts))).toBe(pov);
        parts.set(CameraImpulseListener, new Map([[CAM, { channels: 1, gain: 1, use2DDistance: false }]]));
        const near = timelineShakenPOV(one(), 0.6, pov, CAM, shakeDeps(parts));
        expect(Math.hypot(near.x, near.y)).toBeGreaterThan(0.1);
        const far = timelineShakenPOV(one(), 0.6, { ...pov, x: 5000 }, CAM, shakeDeps(parts));
        expect(far.x).toBe(5000);
    });
});
