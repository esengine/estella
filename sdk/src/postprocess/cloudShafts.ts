// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cloudShafts.ts
 * @brief   The sky's clouds, handed to the fog so its beams stand where the clouds let the sun through.
 *
 * @details The fog walks the air against the shadow map, which knows nothing of the clouds: they are drawn by the sky, kilometres up. The sky's
 *          cloud layer (coverage, height, thickness, wind) is copied onto the fog each frame, so its shader can march the sun's ray up through
 *          the same density the dome draws. Only a sky whose clouds cast shadows is followed: those are fixed to the world, and a cloud that rides
 *          with the camera has no place a shaft could stand.
 */
import { getEffectDef } from './effects';
import type { BlendedEffect } from './volumeBlending';

function value(effect: BlendedEffect, type: string, name: string): number {
    const set = effect.uniforms.get(name);
    if (set !== undefined) return set;
    return getEffectDef(type)?.uniforms.find((u) => u.name === name)?.defaultValue ?? 0;
}

/** Writes onto the fog what it reads of the sky's clouds; with no Cloud Shafts, no sky, or clouds that cast no shadow, the fog's clouds are none. */
export function applyCloudsToFog(effects: Map<string, BlendedEffect>): void {
    const fog = effects.get('heightFog');
    if (!fog || !fog.enabled) return;
    const sky = effects.get('skyAtmosphere');
    if (value(fog, 'heightFog', 'u_cloudShade') <= 0 || !sky || !sky.enabled || value(sky, 'skyAtmosphere', 'u_cloudShadow') <= 0) {
        fog.uniforms.set('u_skyCover', 0);
        fog.textures.delete('u_cloudMask');
        fog.textures.delete('u_cloudMask2');
        return;
    }
    const overcast = Math.min(Math.max(value(sky, 'skyAtmosphere', 'u_overcast'), 0), 1);
    const set = (name: string, v: number): void => { fog.uniforms.set(name, v); };
    set('u_skyCover', Math.max(value(sky, 'skyAtmosphere', 'u_clouds'), overcast * 0.95));
    set('u_skyBase', value(sky, 'skyAtmosphere', 'u_cloudBase'));
    set('u_skyThickness', value(sky, 'skyAtmosphere', 'u_cloudThickness'));
    set('u_skyAltitude', value(sky, 'skyAtmosphere', 'u_altitude'));
    set('u_skyUnits', value(sky, 'skyAtmosphere', 'u_unitsPerKm'));
    set('u_skySigma', 1.3 * (1 + overcast * 1.5));
    set('u_skyDriftX', value(sky, 'skyAtmosphere', 'u_cloudDriftX'));
    set('u_skyDriftZ', value(sky, 'skyAtmosphere', 'u_cloudDriftZ'));
    set('u_skyEvolve', value(sky, 'skyAtmosphere', 'u_cloudEvolve'));
    set('u_skyScale', value(sky, 'skyAtmosphere', 'u_cloudScale'));
    set('u_skySoftness', value(sky, 'skyAtmosphere', 'u_cloudSoftness'));
    // The masks that shape those clouds, as the sky has them: the same drawn clouds and the same lit air.
    for (const [mask, tile] of [['u_cloudMask', 'u_cloudMaskTile'], ['u_cloudMask2', 'u_cloudMask2Tile']] as const) {
        const ref = sky.textures.get(mask);
        if (ref) fog.textures.set(mask, ref); else fog.textures.delete(mask);
        set(tile, ref ? value(sky, 'skyAtmosphere', tile) : 0);
    }
}
