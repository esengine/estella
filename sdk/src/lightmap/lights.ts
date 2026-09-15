// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lights.ts
 * @brief   What a bake makes of one authored Light.
 *
 * @details A document states only what an author touched, so every collector has
 *          to fill the rest in — and two of them filling it in separately is two
 *          answers about a field nobody set. The defaults here are the
 *          component's own, and the reading is one function both doors call.
 */

import { LightType } from '../wasm/wasm.generated';
import { COMPONENT_META } from './metaAccess';
import type { BakeLight } from './solve';

/** A Light's authored fields, as loosely as a document may state them. */
export interface AuthoredLight {
    type?: number;
    color?: { r?: number; g?: number; b?: number };
    intensity?: number;
    radius?: number;
    innerAngle?: number;
    outerAngle?: number;
    enabled?: boolean;
}

/** A lamp the bake places, or a contribution to the light from no direction. */
export type BakeLightContribution =
    | { lamp: BakeLight; ambient?: undefined }
    | { ambient: [number, number, number]; lamp?: undefined };

/** Where a light aims: -Z under its rotation, as the renderer reads it. */
export function bakeLightForward(q: { x: number; y: number; z: number; w: number }):
    [number, number, number] {
    const { x, y, z, w } = q;
    return [-2 * (x * z + y * w), -2 * (y * z - x * w), -(1 - 2 * (x * x + y * y))];
}

/**
 * One authored Light as the bake takes it, or null where it contributes nothing.
 *
 * An Ambient light is not a fourth kind of lamp: it occupies no slot and aims
 * nowhere, so it comes back as the term every surface receives.
 */
export function bakeLightOf(authored: AuthoredLight | undefined,
                            position: readonly [number, number, number],
                            rotation: { x: number; y: number; z: number; w: number }):
    BakeLightContribution | null {
    const meta = COMPONENT_META['Light'];
    const v = { ...(meta?.defaults as AuthoredLight | undefined),
                ...(meta?.editorDefaults as AuthoredLight | undefined),
                ...authored };
    const intensity = v.intensity ?? 1;
    if (v.enabled === false || !(intensity > 0)) return null;

    const rgb: [number, number, number] = [v.color?.r ?? 1, v.color?.g ?? 1, v.color?.b ?? 1];
    if ((v.type ?? 0) === LightType.Ambient) {
        return { ambient: [rgb[0] * intensity, rgb[1] * intensity, rgb[2] * intensity] };
    }

    const kind: BakeLight['kind'] = (v.type ?? 0) === LightType.Directional ? 'directional'
        : (v.type ?? 0) === LightType.Spot ? 'spot' : 'point';
    const cos = (deg: number): number => Math.cos((deg * Math.PI) / 360);
    return {
        lamp: {
            kind,
            position: [position[0], position[1], position[2]],
            direction: bakeLightForward(rotation),
            color: rgb,
            intensity,
            radius: kind === 'directional' ? undefined : (v.radius ?? 200),
            innerCos: cos(v.innerAngle ?? 30),
            outerCos: cos(v.outerAngle ?? 45),
        },
    };
}
