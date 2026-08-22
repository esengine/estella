// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { PostProcessVolumeData } from '../ecs/component';
import { getEffectDef } from './effects';

export interface VolumeTransform {
    x: number;
    y: number;
    /** Where the volume sits in depth. Absent = the plane a flat scene draws on. */
    z?: number;
}

export interface ActiveVolume {
    data: PostProcessVolumeData;
    factor: number;
}

export interface BlendedEffect {
    enabled: boolean;
    uniforms: Map<string, number>;
    /** Texture params (sampler uniform -> serialized texture ref). Textures don't
     *  interpolate: the last volume in priority order that sets one wins. */
    textures: Map<string, string>;
}

/**
 * Signed distance to a box, in three dimensions. `halfD` of **0 is unbounded**
 * depth — what a flat scene's box has always been, and the only reading that
 * leaves one unchanged. A box of no thickness contains nothing, so the value is
 * free to mean that.
 */
export function signedDistanceBox(
    px: number, py: number, pz: number,
    cx: number, cy: number, cz: number,
    halfW: number, halfH: number, halfD: number
): number {
    const dx = Math.abs(px - cx) - halfW;
    const dy = Math.abs(py - cy) - halfH;
    const dz = halfD > 0 ? Math.abs(pz - cz) - halfD : -Infinity;
    const out = Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2
        + (halfD > 0 ? Math.max(dz, 0) ** 2 : 0));
    const inside = Math.min(Math.max(dx, dy, halfD > 0 ? dz : -Infinity), 0);
    return out + inside;
}

/** Signed distance to a sphere. A flat scene hands in equal z and gets a circle. */
export function signedDistanceSphere(
    px: number, py: number, pz: number,
    cx: number, cy: number, cz: number,
    radius: number
): number {
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
}

export function computeVolumeFactor(
    volume: PostProcessVolumeData,
    transform: VolumeTransform,
    px: number, py: number, pz = 0
): number {
    if (volume.isGlobal) {
        return volume.weight; // honor the global's weight, like local volumes below
    }

    const cz = transform.z ?? 0;
    let dist: number;
    if (volume.shape === 'sphere') {
        dist = signedDistanceSphere(px, py, pz, transform.x, transform.y, cz, volume.size.x);
    } else {
        dist = signedDistanceBox(px, py, pz, transform.x, transform.y, cz,
                                 volume.size.x, volume.size.y, volume.size.z ?? 0);
    }

    if (dist <= 0) {
        return volume.weight;
    }

    if (volume.blendDistance <= 0) {
        return 0;
    }

    if (dist >= volume.blendDistance) {
        return 0;
    }

    return (1 - dist / volume.blendDistance) * volume.weight;
}

export function blendVolumeEffects(
    activeVolumes: ActiveVolume[]
): Map<string, BlendedEffect> {
    const result = new Map<string, BlendedEffect>();

    const sorted = [...activeVolumes].sort((a, b) => a.data.priority - b.data.priority);

    for (const { data, factor } of sorted) {
        if (factor <= 0) continue;

        for (const effect of data.effects) {
            if (!effect.enabled) continue;

            const existing = result.get(effect.type);
            if (!existing) {
                // Blend from each param's neutral ("effect does nothing") value, not
                // from 0 — else a multiplicative param (contrast/saturation/zoom,
                // neutral 1) fades to 0 (black / extreme distortion) at the edge.
                const def = getEffectDef(effect.type);
                const uniforms = new Map<string, number>();
                for (const [key, value] of Object.entries(effect.uniforms)) {
                    const neutral = def?.uniforms.find((u) => u.name === key)?.neutralValue ?? 0;
                    uniforms.set(key, neutral + (value - neutral) * factor);
                }
                const textures = new Map<string, string>();
                if (effect.textures) {
                    for (const [key, ref] of Object.entries(effect.textures)) {
                        if (ref) textures.set(key, ref);
                    }
                }
                result.set(effect.type, { enabled: true, uniforms, textures });
            } else {
                if (effect.textures) {
                    for (const [key, ref] of Object.entries(effect.textures)) {
                        if (ref) existing.textures.set(key, ref);
                    }
                }
                for (const [key, value] of Object.entries(effect.uniforms)) {
                    const prev = existing.uniforms.get(key) ?? 0;
                    existing.uniforms.set(key, prev + (value - prev) * factor);
                }
            }
        }
    }

    return result;
}
