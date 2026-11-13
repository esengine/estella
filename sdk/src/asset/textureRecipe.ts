// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    textureRecipe.ts
 * @brief   A texture that is a recipe: a picture's source (an `.esimage`) shipped in place of its pixels and drawn where it is loaded.
 *
 * @details A package that ships a picture ships every pixel of it; one that ships how the picture is drawn ships a few hundred bytes
 *          and pays for the drawing once, on the device. Whoever reads an image (the texture loader, a ground reading its layers)
 *          asks here for any path that is a recipe. What draws one is not in the core: importing `esengine/image` installs it, so a
 *          game with no recipe does not carry the raster.
 *
 *          A recipe may need other files of the project: a picture it lays in, a font, the recipe it is a map of. The drawer says
 *          which, they are read here, and a drawn picture is kept in the platform's content cache under all it was drawn from: the
 *          source, those files' own bytes, and the drawer's revision. A change in any of them is another key.
 */
import { contentHashHex } from './contentHash';
import { platformReadCacheFile, platformWriteCacheFile } from '../platform';
import { decodeUtf8, encodeUtf8 } from '../util/utf8';

/** The pixels a recipe draws: top row first, RGBA, as a decoded image is. */
export interface RecipePixels { width: number; height: number; pixels: Uint8Array }

/** Reads a file of the project by its project path, as the asset layer would. */
export type RecipeFileReader = (path: string) => Promise<ArrayBuffer>;

/** What draws recipes. */
export interface TextureRecipeDrawer {
    /** How it draws, as a name: it changes whenever the same source would come out as other pixels. */
    revision: string;
    /** The project files a source needs beside itself, by project path. */
    needs(source: string): readonly string[];
    /** The picture of a source, with every file it needs (and those the recipes among them need) to hand. */
    draw(source: string, files: ReadonlyMap<string, ArrayBuffer>, path: string): RecipePixels | Promise<RecipePixels>;
}

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
let drawer: TextureRecipeDrawer | null = null;
const stats: TextureRecipeStats = { drawn: 0, drawMs: 0, reused: 0 };

/** Whether a texture's path names a recipe and not an image. */
export function isTextureRecipePath(path: string): boolean {
    const end = path.indexOf('?');
    return (end < 0 ? path : path.slice(0, end)).toLowerCase().endsWith(RECIPE_EXTENSION);
}

/** Installs what draws recipes (null takes it out again). `esengine/image` does this on import. */
export function setTextureRecipeDrawer(next: TextureRecipeDrawer | null): void {
    drawer = next;
}

export function hasTextureRecipeDrawer(): boolean {
    return drawer !== null;
}

/** The counts so far; `clear` starts them again. */
export function textureRecipeStats(clear = false): TextureRecipeStats {
    const now = { ...stats };
    if (clear) { stats.drawn = 0; stats.drawMs = 0; stats.reused = 0; }
    return now;
}

/** The content cache's key for a recipe: the drawer's revision, and the hash of the source with the files it was drawn from. */
export function textureRecipeCacheKey(source: string, files: ReadonlyMap<string, ArrayBuffer> = new Map(), revision = drawer?.revision ?? ''): string {
    const from = [...files.keys()].sort().map((path) => `\n${path}:${contentHashHex(new Uint8Array(files.get(path)!))}`).join('');
    return `estella:texture-recipe:${revision}:${contentHashHex(encodeUtf8(source + from))}`;
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

/** Reads what `source` needs into `files`, and what the recipes among those need, each file once. */
async function gather(by: TextureRecipeDrawer, source: string, read: RecipeFileReader, files: Map<string, ArrayBuffer>, root: string): Promise<void> {
    for (const need of by.needs(source)) {
        if (need === root) throw new Error(`recipe "${root}" needs itself`);
        if (files.has(need)) continue;
        const bytes = await read(need);
        files.set(need, bytes);
        if (isTextureRecipePath(need)) await gather(by, decodeUtf8(new Uint8Array(bytes)), read, files, root);
    }
}

/** The pixels of the recipe at `path`: read back where an earlier run drew them, drawn and kept otherwise. */
export async function renderTextureRecipe(path: string, read: RecipeFileReader): Promise<RecipePixels> {
    const by = drawer;
    if (!by) throw new Error(`texture "${path}" is a recipe, and nothing here draws recipes: import 'esengine/image' where the game starts`);
    const source = decodeUtf8(new Uint8Array(await read(path)));
    const files = new Map<string, ArrayBuffer>();
    await gather(by, source, read, files, path);
    const key = textureRecipeCacheKey(source, files, by.revision);
    const kept = await platformReadCacheFile(key);
    const got = kept ? unpack(kept) : null;
    if (got) { stats.reused++; return got; }
    const began = Date.now();
    const drawn = await by.draw(source, files, path);
    stats.drawn++;
    stats.drawMs += Date.now() - began;
    // Kept for the next run without holding this one up; a platform with no cache, or a full one, only means it is drawn again.
    void platformWriteCacheFile(key, pack(drawn));
    return drawn;
}
