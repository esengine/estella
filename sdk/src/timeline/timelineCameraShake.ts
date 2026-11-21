// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineCameraShake.ts
 * @brief   What a timeline's camera shake tracks do to a view at a time: the shake as play draws it, worked out at once.
 *
 * @details In play a shake track fires its shakes as the playhead crosses them (TimelineDrive), and the camera rig ages
 *          them frame by frame. A preview that scrubs cannot age anything, so this works out the same view from the
 *          shakes alone: every shake at or before the time, `time - shake.time` seconds into it, from where its track's
 *          entity is. As in play, a track on an entity with a CameraImpulseSource jolts a camera that has a
 *          CameraImpulseListener by its distance, and one on any other entity shakes the view where it is. So a Camera Shake
 *          section shows in the viewport while it is scrubbed.
 */
import { TrackType, type TimelineAsset } from './TimelineTypes';
import type { Entity } from '../types';
import type { CameraPOV } from '../camera/CameraPlugin';
import { shakenPOV } from '../camera/CameraDirector';
import {
    CameraImpulseListener, CameraImpulseSource, impulsedPOV,
    type CameraImpulseListenerData, type CameraImpulseSourceData,
} from '../camera/CameraImpulse';
import { Transform } from '../ecs/component';

/**
 * The view shake a shake track gives at force 1 on an entity with no CameraImpulseSource: how far it throws the view,
 * how much it rolls it (radians), how fast it trembles and how long it lasts.
 */
export const TIMELINE_VIEW_SHAKE = { amplitude: 12, rotation: 0.008726646259971648 /* π / 360: half a degree */ as number, frequency: 22, duration: 0.4 } as const;

/** What the shakes are worked out from: the world, the timeline's root, and how its tracks' paths resolve. */
export interface TimelineShakeDeps {
    world: {
        valid(e: Entity): boolean;
        tryGet(e: Entity, def: unknown): unknown;
    };
    root: Entity;
    resolveChild(root: Entity, childPath: string): Entity | null;
}

/** A noise seed for the `i`th shake of track `ti`: the same shake trembles the same way at every look. */
const seedOf = (ti: number, i: number) => 977 + ti * 131 + i * 31;

/**
 * `pov`, the view of `camera`, as `asset`'s camera shake tracks leave it at `time`: each shake at or before `time`,
 * that far into it. The view itself is returned when no shake reaches it.
 */
export function timelineShakenPOV(asset: TimelineAsset, time: number, pov: CameraPOV, camera: Entity, deps: TimelineShakeDeps): CameraPOV {
    let view = pov;
    const { world } = deps;
    let listener: CameraImpulseListenerData | null | undefined;
    asset.tracks.forEach((track, ti) => {
        if (track.type !== TrackType.CameraShake || track.muted) return;
        const from = track.childPath ? deps.resolveChild(deps.root, track.childPath) : deps.root;
        if (from == null || !world.valid(from)) return;
        const source = world.tryGet(from, CameraImpulseSource) as CameraImpulseSourceData | null;
        const at = source ? (world.tryGet(from, Transform) as { worldPosition: { x: number; y: number; z: number } } | null) : null;
        track.shakes.forEach((s, i) => {
            if (s.time > time || !(s.force > 0)) return;
            const elapsed = time - s.time;
            if (source && at) {
                // As fired in play: felt only by a camera that listens.
                if (listener === undefined) listener = world.valid(camera) ? world.tryGet(camera, CameraImpulseListener) as CameraImpulseListenerData | null : null;
                if (!listener) return;
                view = impulsedPOV(view, { origin: at.worldPosition, def: source, force: s.force, seed: seedOf(ti, i) }, listener, elapsed);
            } else {
                const k = s.force;
                view = shakenPOV(view, {
                    amplitude: TIMELINE_VIEW_SHAKE.amplitude * k, rotation: TIMELINE_VIEW_SHAKE.rotation * k,
                    frequency: TIMELINE_VIEW_SHAKE.frequency, duration: TIMELINE_VIEW_SHAKE.duration, seed: seedOf(ti, i),
                }, elapsed);
            }
        });
    });
    return view;
}
