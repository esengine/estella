// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  textureUse.ts — which component fields read a texture as numbers.
 *
 * A texture is a picture unless something says otherwise, and a build treats a picture as one: capped at a size, compressed,
 * decoded as colour. The fields here read each texel as a number instead (a Terrain's heights and its layer weights), where every one of those is
 * different data. The texture's own import setting (`use: 'data'`) is what a build obeys; this is what the editor sets it by
 * when a texture is put in such a field, and what Project Health holds the two together with.
 */

/** Component type to the texture fields of it that are read as numbers. */
export const DATA_TEXTURE_FIELDS: Readonly<Record<string, readonly string[]>> = {
    // The splatmaps are weights, four a texel: a picture's clear-texel fill writes its neighbours' colour wherever the fourth is 0.
    Terrain: ['heightmap', 'splatmap', 'splatmap2', 'occlusionMap'],
    // How many plants stand where: a number a texel.
    Foliage: ['densityMap'],
};

/** Whether `component.field` reads its texture as numbers. */
export function readsTextureAsNumbers(component: string, field: string): boolean {
    return DATA_TEXTURE_FIELDS[component]?.includes(field) ?? false;
}
