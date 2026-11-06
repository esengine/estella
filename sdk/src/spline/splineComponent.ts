// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    splineComponent.ts
 * @brief   The Spline component alone, which the plugin that drives it and what is built from it both read.
 */
import { defineComponent, type ComponentDef } from '../ecs/component';
import type { SplinePoint } from './curve';

/** The fields of the `Spline` component. @experimental */
export interface SplineData {
    /** The points the curve passes through, in the entity's own space, in order, each with the width of whatever follows it there. */
    points: SplinePoint[];
    /** Whether the curve joins its end to its start. Needs three points. */
    closed: boolean;
}

/**
 * A curve through points. It is read by what follows it (a river's `WaterBody` on the same entity, a {@link PathFollower} on another).
 *
 * @experimental
 */
export const Spline: ComponentDef<SplineData> = defineComponent<SplineData>('Spline', {
    points: [{ x: -10, y: 0, z: 0, width: 4 }, { x: 10, y: 0, z: 0, width: 4 }] as SplinePoint[],
    closed: false,
}, {
    fields: {
        points: { category: 'Shape', tooltip: 'The points the curve passes through, in order, in the entity\'s own space. Each carries the width of whatever follows the curve there.' },
        closed: { category: 'Shape', tooltip: 'Join the end of the curve to its start (three points or more).' },
    },
});
