import { getSettingsValue } from './SettingsRegistry';

export const MAX_COLLISION_LAYERS = 16;

export function getLayerName(index: number): string {
    return getSettingsValue<string>(`physics.layerName${index}`) ?? '';
}

export function getNamedLayers(): { index: number; name: string }[] {
    const result: { index: number; name: string }[] = [];
    for (let i = 0; i < MAX_COLLISION_LAYERS; i++) {
        const name = getLayerName(i);
        if (name) {
            result.push({ index: i, name });
        }
    }
    return result;
}

export function layerIndexFromBits(bits: number): number {
    for (let i = 0; i < MAX_COLLISION_LAYERS; i++) {
        if (bits === (1 << i)) return i;
    }
    return 0;
}

export function bitsFromLayerIndex(index: number): number {
    return 1 << index;
}

export function getLayerMask(layerIndex: number): number {
    return getSettingsValue<number>(`physics.layerMask${layerIndex}`) ?? 0xFFFF;
}
