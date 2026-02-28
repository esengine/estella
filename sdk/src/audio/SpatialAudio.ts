export enum AttenuationModel {
    Linear = 0,
    Inverse,
    Exponential,
}

export interface SpatialAudioConfig {
    model: AttenuationModel;
    refDistance: number;
    maxDistance: number;
    rolloff: number;
}

const DEFAULT_SPATIAL_CONFIG: SpatialAudioConfig = {
    model: AttenuationModel.Inverse,
    refDistance: 100,
    maxDistance: 1000,
    rolloff: 1.0,
};

export function calculateAttenuation(
    distance: number,
    config: SpatialAudioConfig = DEFAULT_SPATIAL_CONFIG
): number {
    const { model, refDistance, maxDistance, rolloff } = config;
    const d = Math.max(distance, 0.001);

    let result: number;
    switch (model) {
        case AttenuationModel.Linear: {
            const range = maxDistance - refDistance;
            if (range <= 0) return 1.0;
            const clamped = Math.min(Math.max(d, refDistance), maxDistance);
            result = 1 - (clamped - refDistance) / range;
            break;
        }
        case AttenuationModel.Inverse: {
            result = refDistance / Math.max(d, refDistance);
            break;
        }
        case AttenuationModel.Exponential: {
            result = Math.pow(Math.max(d, refDistance) / refDistance, -rolloff);
            break;
        }
        default:
            return 1;
    }
    return Math.max(0, Math.min(1, result));
}

export function calculatePanning(
    sourceX: number, sourceY: number,
    listenerX: number, listenerY: number,
    maxDistance: number
): number {
    const dx = sourceX - listenerX;
    return Math.max(-1, Math.min(1, dx / maxDistance));
}
