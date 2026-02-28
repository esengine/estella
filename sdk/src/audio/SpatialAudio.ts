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

    switch (model) {
        case AttenuationModel.Linear: {
            const clamped = Math.min(Math.max(d, refDistance), maxDistance);
            return 1 - (clamped - refDistance) / (maxDistance - refDistance);
        }
        case AttenuationModel.Inverse: {
            return refDistance / Math.max(d, refDistance);
        }
        case AttenuationModel.Exponential: {
            return Math.pow(Math.max(d, refDistance) / refDistance, -rolloff);
        }
        default:
            return 1;
    }
}

export function calculatePanning(
    sourceX: number, sourceY: number,
    listenerX: number, listenerY: number,
    maxDistance: number
): number {
    const dx = sourceX - listenerX;
    return Math.max(-1, Math.min(1, dx / maxDistance));
}
