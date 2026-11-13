// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audioRecipe.ts
 * @brief   A clip that is a recipe: a sound's or a piece of music's source (`.essound`, `.esmusic`) shipped in place of its samples and
 *          made where it is loaded.
 *
 * @details A package that ships a minute of music ships a megabyte of it, compressed; one that ships how the music is played ships a
 *          few kilobytes and pays for the playing once, on the device. Whoever loads a clip asks here for any path that is a recipe,
 *          and is handed the bytes of a `.wav`, which every audio backend already reads. What makes one is not in the core:
 *          importing `esengine/sound` installs it, so a game with no recipe does not carry the synthesis.
 *
 *          A recipe may play recordings of the project (a sampled instrument, a sample layer). The maker says which, they are read
 *          here, and what was made is kept in the platform's content cache under all it was made from: the source, those files'
 *          own bytes, and the maker's revision. A change in any of them is another key. See textureRecipe.ts, which this follows.
 */
import { contentHashHex } from './contentHash';
import { platformReadCacheFile, platformWriteCacheFile } from '../platform';
import { decodeUtf8, encodeUtf8 } from '../util/utf8';

/** Reads a file of the project by its project path, as the asset layer would. */
export type AudioRecipeFileReader = (path: string) => Promise<ArrayBuffer>;

/** What makes recipes. */
export interface AudioRecipeMaker {
    /** How it sounds, as a name: it changes whenever the same source would come out as other samples. */
    revision: string;
    /** The recordings a source plays, by project path. */
    needs(source: string, path: string): readonly string[];
    /** The clip of a source as the bytes of a `.wav`, with every recording it plays to hand. */
    make(source: string, files: ReadonlyMap<string, ArrayBuffer>, path: string): ArrayBuffer | Promise<ArrayBuffer>;
}

/** What recipes have cost since the game began (or since the counts were last cleared). */
export interface AudioRecipeStats {
    /** Recipes made, and how long the making took in all, in milliseconds of the clock on the wall. */
    made: number;
    makeMs: number;
    /** Recipes read back from the content cache, made by an earlier run. */
    reused: number;
}

const RECIPE_EXTENSIONS = ['.essound', '.esmusic'] as const;
let maker: AudioRecipeMaker | null = null;
const stats: AudioRecipeStats = { made: 0, makeMs: 0, reused: 0 };

/** Whether a clip's path names a recipe and not a recording. */
export function isAudioRecipePath(path: string): boolean {
    const end = path.indexOf('?');
    const bare = (end < 0 ? path : path.slice(0, end)).toLowerCase();
    return RECIPE_EXTENSIONS.some((ext) => bare.endsWith(ext));
}

/** Installs what makes recipes (null takes it out again). `esengine/sound` does this on import. */
export function setAudioRecipeMaker(next: AudioRecipeMaker | null): void {
    maker = next;
}

export function hasAudioRecipeMaker(): boolean {
    return maker !== null;
}

/** The counts so far; `clear` starts them again. */
export function audioRecipeStats(clear = false): AudioRecipeStats {
    const now = { ...stats };
    if (clear) { stats.made = 0; stats.makeMs = 0; stats.reused = 0; }
    return now;
}

/** The content cache's key for a recipe: the maker's revision, and the hash of the source with the files it was made from. */
export function audioRecipeCacheKey(source: string, files: ReadonlyMap<string, ArrayBuffer> = new Map(), revision = maker?.revision ?? ''): string {
    const from = [...files.keys()].sort().map((path) => `\n${path}:${contentHashHex(new Uint8Array(files.get(path)!))}`).join('');
    return `estella:audio-recipe:${revision}:${contentHashHex(encodeUtf8(source + from))}`;
}

/** A kept clip is read back only if it is a `.wav` at all: anything else is made again and written over. */
function isWav(bytes: ArrayBuffer): boolean {
    if (bytes.byteLength < 44) return false;
    const b = new Uint8Array(bytes, 0, 12);
    return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45;
}

/** The `.wav` of the recipe at `path`: read back where an earlier run made it, made and kept otherwise. */
export async function renderAudioRecipe(path: string, read: AudioRecipeFileReader): Promise<ArrayBuffer> {
    const by = maker;
    if (!by) throw new Error(`clip "${path}" is a recipe, and nothing here makes recipes: import 'esengine/sound' where the game starts`);
    const source = decodeUtf8(new Uint8Array(await read(path)));
    const files = new Map<string, ArrayBuffer>();
    for (const need of by.needs(source, path)) if (!files.has(need)) files.set(need, await read(need));
    const key = audioRecipeCacheKey(source, files, by.revision);
    const kept = await platformReadCacheFile(key);
    if (kept && isWav(kept)) { stats.reused++; return kept; }
    const began = Date.now();
    const made = await by.make(source, files, path);
    stats.made++;
    stats.makeMs += Date.now() - began;
    // Kept for the next run without holding this one up; a platform with no cache, or a full one, only means it is made again.
    // A copy, since the caller hands the bytes to a decoder that may take them.
    void platformWriteCacheFile(key, made.slice(0));
    return made;
}
