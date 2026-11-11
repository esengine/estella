// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    screenProbes.ts
 * @brief   A probe: the light that arrives at a surface point from every direction of its hemisphere (docs/GI_LUMEN_DESIGN.md, 3.4).
 *
 * @details A probe is an 8 x 8 octahedral map of rays. Each ray is traced through the scene distance field; where it stops, the surface
 *          cache says what that surface gives out (the cache's `lookup`), and where it leaves the field the sky says. The map is then
 *          integrated against any normal: that is what makes one probe serve the pixels around it, whose normals differ a little from
 *          the probe's own.
 *
 *          The rays of a probe are the hemisphere about its normal, uniform in solid angle, so the diffuse light for a normal n
 *          is `2/N * sum(L_i * max(n.d_i, 0))` in the engine's units (irradiance over pi, which a diffuse surface multiplies by albedo).
 *
 *          This is the CPU reference of the pass the GPU runs per 8 x 8 tile of the picture.
 */
import type { GlobalSdf } from './globalSdf';
import type { SurfaceCache } from './surfaceCache';

export const PROBE_SIZE = 8;

export interface ProbeScene {
    sdf: GlobalSdf;
    cache: SurfaceCache;
    /** Radiance of a ray that leaves the field without hitting anything. */
    sky?: (dir: readonly [number, number, number]) => readonly [number, number, number];
    /** How far a ray looks. */
    range: number;
    /** How far off the surface a ray starts: must clear the growth of the distance field. */
    bias: number;
    /** How far from a hit point a card pixel may be and still be that surface. */
    tolerance: number;
}

export interface Probe {
    position: [number, number, number];
    normal: [number, number, number];
    /** PROBE_SIZE^2 unit directions (hemisphere about the normal) and the radiance that came along each. */
    directions: Float32Array;
    radiance: Float32Array;
}

/** The unit vector an octahedral map holds at (u, v) in [0, 1)^2 (Cigolle et al. 2014). */
export function octahedralDecode(u: number, v: number): [number, number, number] {
    const x = u * 2 - 1, y = v * 2 - 1;
    let z = 1 - Math.abs(x) - Math.abs(y), px = x, py = y;
    if (z < 0) { px = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1); py = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1); }
    const l = Math.hypot(px, py, z);
    return [px / l, py / l, z / l];
}

function hash(a: number, b: number, c: number): number {
    let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** Traces a probe at a surface point. `frame` varies the jitter inside each octahedral cell so successive frames cover the hemisphere. */
export function tracePoint(scene: ProbeScene, position: readonly [number, number, number], normal: readonly [number, number, number], frame = 0, seed = 0): Probe {
    const n = PROBE_SIZE * PROBE_SIZE, directions = new Float32Array(n * 3), radiance = new Float32Array(n * 3);
    const origin: [number, number, number] = [position[0] + normal[0] * scene.bias, position[1] + normal[1] * scene.bias, position[2] + normal[2] * scene.bias];
    for (let j = 0; j < PROBE_SIZE; j++) for (let i = 0; i < PROBE_SIZE; i++) {
        const k = i + j * PROBE_SIZE;
        const jx = hash(i, j, seed * 31 + frame * 7 + 1), jy = hash(i, j, seed * 17 + frame * 13 + 2);
        let d = octahedralDecode((i + jx) / PROBE_SIZE, (j + jy) / PROBE_SIZE);
        if (d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2] < 0) {
            // Mirror the lower half about the surface: the hemisphere is covered twice as densely and stays uniform.
            const dn = d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2];
            d = [d[0] - 2 * dn * normal[0], d[1] - 2 * dn * normal[1], d[2] - 2 * dn * normal[2]];
        }
        directions.set(d, k * 3);
        const t = scene.sdf.sphereTrace(origin, d, scene.range);
        let r: readonly [number, number, number] | null;
        if (t === null) {
            r = scene.sky ? scene.sky(d) : [0, 0, 0];
            // A ray that left the field's window without reaching `range` has not met a surface either; the sky is all it can see.
        } else if (t < 1e-3) {
            // The ray starts inside the field's body (a pixel in the corner of two walls, whose offset point is in one of them): it sees
            // nothing of the room, and a lookup from inside a wall would answer with whichever face of it the ray's direction picks.
            r = [0, 0, 0];
        } else {
            const hit: [number, number, number] = [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t];
            r = scene.cache.lookup(hit, d, scene.tolerance) ?? [0, 0, 0];
        }
        radiance.set(r, k * 3);
    }
    return { position: [...position], normal: [...normal], directions, radiance };
}

/** The light a diffuse surface facing `normal` takes from the probe, in the engine's units (to be multiplied by albedo). */
export function probeIrradiance(probe: Probe, normal: readonly [number, number, number]): [number, number, number] {
    const n = PROBE_SIZE * PROBE_SIZE, sum = [0, 0, 0];
    for (let k = 0; k < n; k++) {
        const c = probe.directions[k * 3]! * normal[0] + probe.directions[k * 3 + 1]! * normal[1] + probe.directions[k * 3 + 2]! * normal[2];
        if (c <= 0) continue;
        for (let ch = 0; ch < 3; ch++) sum[ch] += probe.radiance[k * 3 + ch]! * c;
    }
    return [(2 * sum[0]!) / n, (2 * sum[1]!) / n, (2 * sum[2]!) / n];
}

/**
 * Many bounces by iteration: each round relights the cache with the indirect light the previous round's cache gives, so round k holds
 * the first k bounces. The cache's `light` is handed the probe integral as its indirect term.
 */
export function solveBounces(scene: ProbeScene, lightOptions: Parameters<SurfaceCache['light']>[0], bounces: number): void {
    scene.cache.light({ ...lightOptions, indirect: undefined });
    for (let b = 0; b < bounces; b++) {
        let seed = 0;
        const next = new Map<string, [number, number, number]>();
        scene.cache.light({
            ...lightOptions,
            indirect: (position, normal) => {
                // Two faces can share a point (a wall's top and the ceiling's underside): the normal is part of the key.
                const key = `${position[0].toFixed(3)},${position[1].toFixed(3)},${position[2].toFixed(3)}:${normal[0].toFixed(2)},${normal[1].toFixed(2)},${normal[2].toFixed(2)}`;
                let g = next.get(key);
                if (!g) { g = probeIrradiance(tracePoint(scene, position, normal, b, seed++), normal); next.set(key, g); }
                return g;
            },
        });
    }
}
