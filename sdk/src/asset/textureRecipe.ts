// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    textureRecipe.ts
 * @brief   A texture that is a recipe: a picture's source (an `.esimage`) shipped in place of its pixels and drawn where it is loaded.
 *
 * @details A package that ships a picture ships every pixel of it; one that ships how the picture is drawn ships a few hundred bytes
 *          and pays for the drawing once, on the device. The texture loader asks here for any path that is a recipe. What draws
 *          one is not in the core: importing `esengine/image` installs it, so a game with no recipe does not carry the raster.
 */

/** The pixels a recipe draws: top row first, RGBA, as a decoded image is. */
export interface RecipePixels { width: number; height: number; pixels: Uint8Array }

/** Draws a recipe from its source text. */
export type TextureRecipeRenderer = (source: string, path: string) => RecipePixels | Promise<RecipePixels>;

const RECIPE_EXTENSION = '.esimage';
let renderer: TextureRecipeRenderer | null = null;

/** Whether a texture's path names a recipe and not an image. */
export function isTextureRecipePath(path: string): boolean {
    const end = path.indexOf('?');
    return (end < 0 ? path : path.slice(0, end)).toLowerCase().endsWith(RECIPE_EXTENSION);
}

/** Installs what draws recipes (null takes it out again). `esengine/image` does this on import. */
export function setTextureRecipeRenderer(next: TextureRecipeRenderer | null): void {
    renderer = next;
}

export function hasTextureRecipeRenderer(): boolean {
    return renderer !== null;
}

/** The pixels of the recipe at `path`, whose source is `source`. */
export async function renderTextureRecipe(source: string, path: string): Promise<RecipePixels> {
    if (!renderer) throw new Error(`texture "${path}" is a recipe, and nothing here draws recipes: import 'esengine/image' where the game starts`);
    return renderer(source, path);
}
