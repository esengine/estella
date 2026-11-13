// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    textureRecipe.ts
 * @brief   A texture that is a recipe: a picture's source (an `.esimage`) shipped in place of its pixels and drawn where it is loaded.
 *
 * @details A package that ships a picture ships every pixel of it; one that ships how the picture is drawn ships a few hundred bytes
 *          and pays for the drawing once, on the device. The texture loader asks here for any path that is a recipe. What draws
 *          one is not in the core: importing `esengine/image` installs it, so a game with no recipe does not carry the raster.
 *
 *          A drawn picture is kept in the platform's content cache under what it was drawn from (the source's own hash and the
 *          drawer's revision), so the next run reads it back and draws nothing. The key says what the bytes are, as every key of
 *          that cache does: a source that changes is another key, and so is a drawer that draws differently.
 */
import { contentHashHex } from './contentHash';
import { platformReadCacheFile, platformWriteCacheFile } from '../platform';
import { encodeUtf8 } from '../util/utf8';

/** The pixels a recipe draws: top row first, RGBA, as a decoded image is. */
export interface RecipePixels { width: number; height: number; pixels: Uint8Array }

/** Draws a recipe from its source text. */
export type TextureRecipeRenderer = (source: string, path: string) => RecipePixels | Promise<RecipePixels>;

/** What recipes have cost since the game began (or since the counts were last cleared). */
export interface TextureRecipeStats {
    /** Recipes drawn, and how long the drawing took in all, in milliseconds of the clock on the wall. */
    drawn: number;
    drawMs: number;
    /** Recipes read back from the content cache, drawn by an earlier run. */
    reused: number;
}

const RECIPE_EXTENSION = '.esimage';
/** A kept picture's bytes: two sizes, then its pixels. */
const KEPT_HEADER = 8;
let renderer: TextureRecipeRenderer | null = null;
let revision = '';
const stats: TextureRecipeStats = { drawn: 0, drawMs: 0, reused: 0 };

/** Whether a texture's path names a recipe and not an image. */
export function isTextureRecipePath(path: string): boolean {
    const end = path.indexOf('?');
    return (end < 0 ? path : path.slice(0, end)).toLowerCase().endsWith(RECIPE_EXTENSION);
}

/**
 * Installs what draws recipes (null takes it out again). `esengine/image` does this on import. `drawerRevision` names how it draws:
 * it changes whenever the same source would come out as other pixels, and a picture kept under another revision is not read.
 */
export function setTextureRecipeRenderer(next: TextureRecipeRenderer | null, drawerRevision = ''): void {
    renderer = next;
    revision = drawerRevision;
}

export function hasTextureRecipeRenderer(): boolean {
    return renderer !== null;
}

/** The counts so far; `clear` starts them again. */
export function textureRecipeStats(clear = false): TextureRecipeStats {
    const now = { ...stats };
    if (clear) { stats.drawn = 0; stats.drawMs = 0; stats.reused = 0; }
    return now;
}

/** The content cache's key for a recipe: the drawer's revision and the source's own hash. */
export function textureRecipeCacheKey(source: string, drawerRevision = revision): string {
    return `estella:texture-recipe:${drawerRevision}:${contentHashHex(encodeUtf8(source))}`;
}

function unpack(bytes: ArrayBuffer): RecipePixels | null {
    if (bytes.byteLength < KEPT_HEADER) return null;
    const head = new DataView(bytes);
    const width = head.getUint32(0, true), height = head.getUint32(4, true);
    // A kept picture that is not the size it says is not read: it is drawn again and written over.
    if (width === 0 || height === 0 || bytes.byteLength !== KEPT_HEADER + width * height * 4) return null;
    return { width, height, pixels: new Uint8Array(bytes, KEPT_HEADER) };
}

function pack(drawn: RecipePixels): ArrayBuffer {
    const bytes = new ArrayBuffer(KEPT_HEADER + drawn.pixels.byteLength);
    const head = new DataView(bytes);
    head.setUint32(0, drawn.width, true);
    head.setUint32(4, drawn.height, true);
    new Uint8Array(bytes, KEPT_HEADER).set(drawn.pixels);
    return bytes;
}

/** The pixels of the recipe at `path`, whose source is `source`: read back where an earlier run drew them, drawn and kept otherwise. */
export async function renderTextureRecipe(source: string, path: string): Promise<RecipePixels> {
    if (!renderer) throw new Error(`texture "${path}" is a recipe, and nothing here draws recipes: import 'esengine/image' where the game starts`);
    const key = textureRecipeCacheKey(source);
    const kept = await platformReadCacheFile(key);
    const read = kept ? unpack(kept) : null;
    if (read) { stats.reused++; return read; }
    const began = Date.now();
    const drawn = await renderer(source, path);
    stats.drawn++;
    stats.drawMs += Date.now() - began;
    // Kept for the next run without holding this one up; a platform with no cache, or a full one, only means it is drawn again.
    void platformWriteCacheFile(key, pack(drawn));
    return drawn;
}
