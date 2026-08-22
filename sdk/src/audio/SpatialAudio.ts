// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SpatialAudio.ts — where a sound is, relative to who is hearing it.
 *
 * Three-dimensional throughout. A scene has depth whether or not its art does,
 * and a distance that drops z reports a source across the room as being in the
 * listener's ear.
 */
import type { Vec3 } from '../types';

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

/** How far apart two points are, in the three dimensions a scene has. */
export function spatialDistance(source: Vec3, listener: Vec3): number {
    const dx = source.x - listener.x;
    const dy = source.y - listener.y;
    const dz = source.z - listener.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Stereo pan for a source heard by a listener whose own right points along
 * `right`: how far along that right the source sits, over the audible radius.
 * Against the LISTENER'S right, not world +X — a listener that has turned hears
 * the world turn with it, and an unturned one's right IS world +X.
 */
export function calculatePanning(
    source: Vec3,
    listener: Vec3,
    right: Vec3,
    maxDistance: number
): number {
    const along = (source.x - listener.x) * right.x
        + (source.y - listener.y) * right.y
        + (source.z - listener.z) * right.z;
    // Guard maxDistance: 0 would yield NaN, which StereoPannerNode.pan throws on.
    return Math.max(-1, Math.min(1, along / Math.max(maxDistance, 1e-3)));
}
