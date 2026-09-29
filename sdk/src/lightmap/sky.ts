// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    sky.ts
 * @brief   The sky a gather sees, as data: a bake that runs on several threads
 *          hands each one the description, and a closure cannot cross.
 */

import type { SkyRadiance } from './reflection';
import { SH_COSINE_BAND, evalIrradianceSH } from './sh';

/** A sky a bake can pass between threads. */
export type SkySpec =
    | { kind: 'flat'; rgb: readonly [number, number, number] }
    /** An environment's nine irradiance coefficients as the frame reads them:
     *  turned `yaw` radians about +Y and scaled by `tint`. */
    | { kind: 'sh'; irradiance: readonly number[]; yaw: number; tint: readonly [number, number, number] };

/**
 * The radiance along each direction whose cosine-weighted mean over an open
 * hemisphere is the spec's irradiance there: the coefficients unconvolved, so an
 * uncovered floor gathers exactly what the frame would light it with.
 */
export function skyRadiance(spec: SkySpec): SkyRadiance {
    if (spec.kind === 'flat') {
        const [r, g, b] = spec.rgb;
        return (_dx, _dy, _dz, out, at) => { out[at] = r; out[at + 1] = g; out[at + 2] = b; };
    }
    const radiance = Float32Array.from(spec.irradiance.slice(0, 27), (v, i) => v / SH_COSINE_BAND[Math.floor(i / 3)]!);
    const c = Math.cos(spec.yaw), s = Math.sin(spec.yaw);
    const [tr, tg, tb] = spec.tint;
    return (dx, dy, dz, out, at) => {
        const [r, g, b] = evalIrradianceSH(radiance, c * dx + s * dz, dy, -s * dx + c * dz);
        out[at] = Math.max(0, r) * tr;
        out[at + 1] = Math.max(0, g) * tg;
        out[at + 2] = Math.max(0, b) * tb;
    };
}
