// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fogOfWarMask.ts
 * @brief   The names the 2D fog of war reads its two maps by, kept apart from its shader so every package can carry the names and only the ones that fog carry the source.
 */
import type { EffectUniformDef } from './effects';

/** The samplers the maps are bound to: where a viewer has ever seen, and where one sees now. */
export const FOG_EXPLORED_TEXTURE = 'u_fogExplored';
export const FOG_VISIBLE_TEXTURE = 'u_fogVisible';

/** The world rectangle the maps cover: its low corner and its size. Written with the maps each frame, so nobody authors them. */
export const FOG_UNIFORMS: EffectUniformDef[] = ['L', 'B', 'W', 'H'].map((edge): EffectUniformDef => ({
    name: `u_fog${edge}`, label: `Fog Map ${edge}`, min: -1e9, max: 1e9, step: 1, defaultValue: 0, internal: true,
}));
