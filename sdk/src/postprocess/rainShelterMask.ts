// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rainShelterSlots.ts
 * @brief   The uniforms the 2D rain reads its shelters from, named apart from its shader so every package can carry the names and only the ones that rain carry the source.
 */
import type { EffectUniformDef } from './effects';

/** How many shelters the 2D rain reads. Each is five numbers: centre x and y, half width and height (negative for round), dryness. */
export const RAIN_SHELTER_SLOTS = 8;
export const SHELTER_FIELDS = ['x', 'y', 'hx', 'hy', 'dry'] as const;
export type ShelterField = typeof SHELTER_FIELDS[number];

/** The name of a shelter slot's uniform. */
export function shelterUniform(slot: number, field: ShelterField): string {
    return `u_sh${slot}${field}`;
}

/** The slots as effect uniforms: internal, because the shelter system writes them and nobody authors them. */
export const RAIN_SHELTER_UNIFORMS: EffectUniformDef[] = Array.from({ length: RAIN_SHELTER_SLOTS }, (_, slot) =>
    SHELTER_FIELDS.map((field): EffectUniformDef => ({
        name: shelterUniform(slot, field), label: `Shelter ${slot} ${field}`, min: -100000, max: 100000, step: 1, defaultValue: 0, internal: true,
    }))).flat();
