// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    textureRecipePath.ts
 * @brief   Whether a path names a picture's recipe, with nothing else in the file.
 *
 * Its own file because the question is asked where nothing of the runtime may come along: the packager deciding what ships, a model's
 * source being checked. The registry that draws recipes (textureRecipe.ts) reads the platform, and they must not have to.
 */

/** The extension of a picture's recipe. */
export const TEXTURE_RECIPE_EXTENSION = '.esimage';

/** Whether a texture's path names a recipe and not an image. */
export function isTextureRecipePath(path: string): boolean {
    const end = path.indexOf('?');
    return (end < 0 ? path : path.slice(0, end)).toLowerCase().endsWith(TEXTURE_RECIPE_EXTENSION);
}
