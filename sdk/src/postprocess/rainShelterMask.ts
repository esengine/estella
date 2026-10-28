// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rainShelterMask.ts
 * @brief   The names the 2D rain reads its shelter mask by, kept apart from its shader so every package can carry the names and only the ones that rain carry the source.
 */
import type { EffectUniformDef } from './effects';

/** The sampler the mask is bound to. */
export const RAIN_SHELTER_MASK_TEXTURE = 'u_shelterMask';

/**
 * How many texels a side the mask is unless the effect says otherwise (its `maskSize`), and the least and most it may be. The view is stretched
 * over it, so a shelter's edge is soft by about the view's size over this.
 */
export const RAIN_SHELTER_MASK_SIZE = 512;
export const RAIN_SHELTER_MASK_MIN = 64;
export const RAIN_SHELTER_MASK_MAX = 2048;

/** The world rectangle the mask covers: its low corner and its size. Written with the mask each frame, so nobody authors them. */
export const RAIN_SHELTER_UNIFORMS: EffectUniformDef[] = ['L', 'B', 'W', 'H'].map((edge): EffectUniformDef => ({
    name: `u_mask${edge}`, label: `Shelter Mask ${edge}`, min: -1e9, max: 1e9, step: 1, defaultValue: 0, internal: true,
}));
