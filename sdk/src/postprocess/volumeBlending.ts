import type { PostProcessVolumeData } from './sync';

export interface VolumeTransform {
    x: number;
    y: number;
}

export interface ActiveVolume {
    data: PostProcessVolumeData;
    factor: number;
}

export interface BlendedEffect {
    enabled: boolean;
    uniforms: Map<string, number>;
}

export function signedDistanceBox(
    px: number, py: number,
    cx: number, cy: number,
    halfW: number, halfH: number
): number {
    const dx = Math.abs(px - cx) - halfW;
    const dy = Math.abs(py - cy) - halfH;
    const outsideDist = Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2);
    const insideDist = Math.min(Math.max(dx, dy), 0);
    return outsideDist + insideDist;
}

export function signedDistanceSphere(
    px: number, py: number,
    cx: number, cy: number,
    radius: number
): number {
    const dx = px - cx;
    const dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy) - radius;
}

export function computeVolumeFactor(
    volume: PostProcessVolumeData,
    transform: VolumeTransform,
    px: number, py: number
): number {
    if (volume.isGlobal) {
        return 1;
    }

    let dist: number;
    if (volume.shape === 'sphere') {
        dist = signedDistanceSphere(px, py, transform.x, transform.y, volume.size.x);
    } else {
        dist = signedDistanceBox(px, py, transform.x, transform.y, volume.size.x, volume.size.y);
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
                const uniforms = new Map<string, number>();
                for (const [key, value] of Object.entries(effect.uniforms)) {
                    uniforms.set(key, value * factor);
                }
                result.set(effect.type, { enabled: true, uniforms });
            } else {
                for (const [key, value] of Object.entries(effect.uniforms)) {
                    const prev = existing.uniforms.get(key) ?? 0;
                    existing.uniforms.set(key, prev + (value - prev) * factor);
                }
            }
        }
    }

    return result;
}
