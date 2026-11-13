// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    recipeWorker.ts
 * @brief   The worker that draws texture recipes: a recipe and the files it needs in, its pixels out, off the thread the game runs on.
 *
 * @details This file is bundled on its own (sdk/scripts/build-worker.mjs) into text `esengine/image` starts its workers from, as the
 *          planning worker is. A job is `{ id, ...RecipeJob }`; its answer is `{ id, result: { width, height, pixels } }` with the
 *          pixels' own buffer handed over, or `{ id, error }`. The same drawRecipe runs on the main thread where there is no worker.
 */
import { renderImage, type ImageTextDrawer, type RgbaBitmap } from './imageRaster';
import { renderMaterialMaps } from './imageMaterial';
import type { ImageSource } from './imageSource';
import { canvasTextDrawer, type TextCanvas } from './imageText';
import { parseRecipe, pictureNeeds } from './recipeSource';
import { decodeUtf8 } from '../util/utf8';

export interface DrawnRecipe { width: number; height: number; pixels: Uint8Array }

/** A recipe to draw, with what it needs to hand. */
export interface RecipeJob {
    source: string;
    /** The recipes and the font files it needs (and those they need), by project path. */
    files: Record<string, ArrayBuffer>;
    /** The pictures it lays in that are images and not recipes, decoded. */
    pictures: Record<string, DrawnRecipe>;
}

/** What the thread a recipe is drawn on has for text: a canvas, and a way to make a font file a family. */
export interface RecipeHost {
    canvas: ((w: number, h: number) => TextCanvas) | null;
    font(family: string, bytes: ArrayBuffer): Promise<void>;
}

/** What a job with text says where there is no canvas: whoever sent it draws it where there is one. */
export const NO_TEXT_CANVAS = 'this thread has no canvas to draw text on';
/** A recipe may lay in a recipe that lays in a recipe, this deep. */
const MAX_NESTING = 8;

const families = new Map<string, string>();
const textOf = (bytes: ArrayBuffer): string => decodeUtf8(new Uint8Array(bytes));

const whole = (rgba: Uint8Array): Uint8Array => (rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength ? rgba : rgba.slice());

function fileOf(job: RecipeJob, path: string): ArrayBuffer {
    const bytes = job.files[path];
    if (!bytes) throw new Error(`there is no file at ${path}`);
    return bytes;
}

/** A picture source drawn, and the options it was drawn with (its surface maps are drawn with the same). */
async function drawPicture(source: ImageSource, job: RecipeJob, host: RecipeHost, depth: number): Promise<{ picture: RgbaBitmap; options: { pictures: Record<string, RgbaBitmap>; text?: ImageTextDrawer } }> {
    const needs = pictureNeeds(source);
    const pictures: Record<string, RgbaBitmap> = {};
    for (const src of needs.pictures) {
        const decoded = job.pictures[src];
        if (decoded) { pictures[src] = { width: decoded.width, height: decoded.height, rgba: decoded.pixels }; continue; }
        if (depth >= MAX_NESTING) throw new Error(`recipes laid in recipes go ${MAX_NESTING} deep at most`);
        const inner = parseRecipe(textOf(fileOf(job, src)));
        if (!('picture' in inner)) throw new Error(`${src} is a map of a picture, and a layer lays in a picture`);
        pictures[src] = (await drawPicture(inner.picture, job, host, depth + 1)).picture;
    }
    let text: ImageTextDrawer | undefined;
    if (needs.text) {
        if (!host.canvas) throw new Error(NO_TEXT_CANVAS);
        for (const font of needs.fonts) {
            if (families.has(font)) continue;
            const family = `esimage-font-${families.size}`;
            await host.font(family, fileOf(job, font));
            families.set(font, family);
        }
        text = canvasTextDrawer(host.canvas, (font) => families.get(font));
    }
    const options = { pictures, ...(text ? { text } : {}) };
    return { picture: renderImage(source, options), options };
}

/** The pixels a recipe draws, in a buffer of their own (one a worker can hand over whole). */
export async function drawRecipe(job: RecipeJob, host: RecipeHost): Promise<DrawnRecipe> {
    const recipe = parseRecipe(job.source);
    if ('picture' in recipe) {
        const { picture } = await drawPicture(recipe.picture, job, host, 0);
        return { width: picture.width, height: picture.height, pixels: whole(picture.rgba) };
    }
    const { mapOf, map } = recipe.map;
    const base = parseRecipe(textOf(fileOf(job, mapOf)));
    if (!('picture' in base)) throw new Error(`${mapOf} is itself a map of a picture`);
    const { picture, options } = await drawPicture(base.picture, job, host, 1);
    const maps = renderMaterialMaps(base.picture, picture, options);
    if (map === 'normal') return { width: maps.normal.width, height: maps.normal.height, pixels: whole(maps.normal.rgba) };
    if (maps.surface) return { width: maps.surface.width, height: maps.surface.height, pixels: whole(maps.surface.rgba) };
    // One roughness and one metal everywhere is one pixel of them, in the layout a drawn map has.
    return { width: 1, height: 1, pixels: new Uint8Array([255, Math.round(maps.roughness * 255), Math.round(maps.metal * 255), 255]) };
}

interface WorkerScope {
    document?: unknown;
    fonts?: { add(face: unknown): void };
    onmessage: ((e: { data: RecipeJob & { id: number } }) => void) | null;
    postMessage(m: unknown, transfer?: ArrayBuffer[]): void;
}
declare const self: WorkerScope | undefined;
declare const OffscreenCanvas: (new (w: number, h: number) => TextCanvas) | undefined;
declare const FontFace: (new (family: string, bytes: ArrayBuffer) => { load(): Promise<unknown> }) | undefined;

if (typeof self !== 'undefined' && typeof self.document === 'undefined') {
    const scope = self;
    const host: RecipeHost = {
        canvas: typeof OffscreenCanvas !== 'undefined' ? (w, h) => new OffscreenCanvas!(w, h) : null,
        async font(family, bytes) {
            if (typeof FontFace === 'undefined' || !scope.fonts) throw new Error(NO_TEXT_CANVAS);
            const face = new FontFace(family, bytes);
            await face.load();
            scope.fonts.add(face);
        },
    };
    scope.onmessage = (e) => {
        const job = e.data;
        drawRecipe(job, host).then(
            (drawn) => scope.postMessage({ id: job.id, result: drawn }, [drawn.pixels.buffer as ArrayBuffer]),
            (err: unknown) => scope.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) }),
        );
    };
}
