// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    components.ts
 * @brief   Perception components. A `Perceiver` senses the nearest visible
 *          `PerceptionTarget`; the system writes the result into `Perception`,
 *          which FSM conditions / BT leaves read via `ctx.get(Perception)` —
 *          perception flows through ECS data, not a side channel.
 */

import { defineComponent, defineTag } from '../../ecs/component';
import { defineEvent, type EventDef } from '../../ecs/event';
import type { Entity } from '../../types';
import type { FacingAxis } from './sense';

export interface PerceiverData {
    /** Sight range in world pixels. */
    range: number;
    /** Field-of-view cone in degrees; 360 = omnidirectional. */
    fovDegrees: number;
    /** Which of the entity's own axes the cone points down — see {@link FacingAxis}. */
    facingAxis: FacingAxis;
    /**
     * Physics layers the line-of-sight ray may hit (3D only; 0 = every layer).
     * A ray cast from inside the observer's own body hits it first and the check
     * has to let that through, so a 3D scene keeps sight honest by casting only
     * against the layers that actually block sight.
     */
    losLayers: number;
    /**
     * How far a {@link Noise} of loudness 1 is heard, in world units; 0 = deaf. A noise is heard within
     * `hearingRange * loudness`, through walls, as Unreal's hearing sense is.
     */
    hearingRange: number;
}

export const Perceiver = defineComponent<PerceiverData>('Perceiver', {
    range: 220,
    fovDegrees: 360,
    facingAxis: 'x',
    losLayers: 0,
    hearingRange: 0,
}, {
    fields: {
        range: { min: 0, unit: 'px', category: 'Perception' },
        fovDegrees: { min: 0, max: 360, unit: '°', category: 'Perception' },
        facingAxis: { category: 'Perception', advanced: true, tooltip: "'x' is screen-right (a flat scene); '-z' is where an imported model faces." },
        losLayers: { min: 0, category: 'Perception', advanced: true, tooltip: '3D layer mask the sight ray may hit; 0 = every layer.' },
        hearingRange: { min: 0, category: 'Perception', tooltip: 'How far a noise of loudness 1 is heard, through walls; 0 = deaf.' },
    },
});

export interface PerceptionData {
    /** A target is currently seen. */
    visible: boolean;
    /** Distance to the seen target (0 when none). */
    distance: number;
    /** Seen target position in world pixels. */
    targetX: number;
    targetY: number;
    targetZ: number;
    /** Unit direction observer→target. */
    dirX: number;
    dirY: number;
    dirZ: number;
    /** A noise was heard this step. */
    heard: boolean;
    /** Where the last noise heard came from. */
    noiseX: number;
    noiseY: number;
    noiseZ: number;
    /** Seconds since that noise; -1 = nothing heard yet. */
    sinceHeard: number;
}

export const Perception = defineComponent<PerceptionData>('Perception', {
    visible: false,
    distance: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    dirX: 0,
    dirY: 0,
    dirZ: 0,
    heard: false,
    noiseX: 0,
    noiseY: 0,
    noiseZ: 0,
    sinceHeard: -1,
}, {
    // Runtime-only: the system rewrites it every frame.
    transient: true,
    fields: {
        visible: { advanced: true, tooltip: 'A target is seen (runtime, read-only).' },
    },
});

/** Tags an entity as sensable by Perceivers. */
export const PerceptionTarget = defineTag('PerceptionTarget');

/** What a noise carries: where it was made, how loud (1 = heard out to a Perceiver's `hearingRange`), and who made it. */
export interface NoisePayload {
    x: number;
    y: number;
    z: number;
    loudness: number;
    /** The entity that made it; it does not hear itself. 0 = no one in particular. */
    source: Entity;
}

/**
 * Something made a sound perceivers may hear (a gunshot, a door, a footfall). Send it with `EventWriter(Noise)`; the
 * perception step reads it the frame after, as every event is read.
 */
export const Noise: EventDef<NoisePayload> = defineEvent<NoisePayload>('Noise', { x: 0, y: 0, z: 0, loudness: 1, source: 0 as Entity });
