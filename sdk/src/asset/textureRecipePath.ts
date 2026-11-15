// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    textureRecipePath.ts
 * @brief   Whether a path names a picture's recipe, with nothing else in the file.
 *
 * Its own file because the question is asked where nothing of the runtime may come along: the packager deciding what ships, a model's
 * source being checked. The registry that draws recipes (textureRecipe.ts) reads the platform, and they must not have to.
 */
import { decodeUtf8 } from '../util/utf8';

/** The extension of a picture's recipe. */
export const TEXTURE_RECIPE_EXTENSION = '.esimage';

/** Whether a texture's path names a recipe and not an image. */
export function isTextureRecipePath(path: string): boolean {
    const end = path.indexOf('?');
    return (end < 0 ? path : path.slice(0, end)).toLowerCase().endsWith(TEXTURE_RECIPE_EXTENSION);
}

export async function gatherRecipeFiles(needs: (source: string) => readonly string[], source: string, read: (path: string) => Promise<ArrayBuffer>, files: Map<string, ArrayBuffer>, root: string): Promise<void> {
    for (const need of needs(source)) {
        if (need === root) throw new Error(`recipe "${root}" needs itself`);
        if (files.has(need)) continue;
        const bytes = await read(need);
        files.set(need, bytes);
        if (isTextureRecipePath(need)) await gatherRecipeFiles(needs, decodeUtf8(new Uint8Array(bytes)), read, files, root);
    }
}
