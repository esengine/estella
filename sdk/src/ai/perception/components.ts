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
}

export const Perceiver = defineComponent<PerceiverData>('Perceiver', {
    range: 220,
    fovDegrees: 360,
    facingAxis: 'x',
    losLayers: 0,
}, {
    fields: {
        range: { min: 0, unit: 'px', category: 'Perception' },
        fovDegrees: { min: 0, max: 360, unit: '°', category: 'Perception' },
        facingAxis: { category: 'Perception', advanced: true, tooltip: "'x' is screen-right (a flat scene); '-z' is where an imported model faces." },
        losLayers: { min: 0, category: 'Perception', advanced: true, tooltip: '3D layer mask the sight ray may hit; 0 = every layer.' },
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
}, {
    // Runtime-only: the system rewrites it every frame.
    transient: true,
    fields: {
        visible: { advanced: true, tooltip: 'A target is seen (runtime, read-only).' },
    },
});

/** Tags an entity as sensable by Perceivers. */
export const PerceptionTarget = defineTag('PerceptionTarget');
