// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { PNG } from 'pngjs';
import { encodeRgbaPng } from '../assets/png';
import { gatherRecipeFiles, isTextureRecipePath } from '../../../sdk/src/asset/textureRecipePath';
import { drawPicture, drawRecipe, NO_TEXT_CANVAS, type DrawnRecipe, type RecipeHost, type RecipeJob } from '../../../sdk/src/image/recipeWorker';
import { parseColor } from './imageNoise';
import { zoomImage, type ImageBox, type RgbaBitmap } from './imageRaster';
import { isFontFile, parseRecipe, recipeNeeds } from './recipeSource';

export interface ImageFileOptions {
    on?: string;
    zoom?: { x: number; y: number; w: number; h: number };
}

export interface ImageFile {
    png: Uint8Array;
    width: number;
    height: number;
    notes: string[];
    bounds: ImageBox | null;
    covers: number | null;
    layerBounds: Record<string, ImageBox>;
}

export type ProjectFileReader = (projectPath: string) => Promise<Uint8Array>;

const NO_FONTS: RecipeHost = {
    canvas: null,
    font: () => Promise.reject(new Error(NO_TEXT_CANVAS)),
};

const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

function decodePicture(path: string, bytes: ArrayBuffer): DrawnRecipe {
    try {
        const png = PNG.sync.read(Buffer.from(bytes));
        return { width: png.width, height: png.height, pixels: new Uint8Array(png.data) };
    } catch {
        throw new Error(`${path} is laid in the picture and is not a PNG, which is what this command reads`);
    }
}

function layOn(image: RgbaBitmap, ground: string): RgbaBitmap {
    const [r, g, b] = parseColor(ground);
    const rgba = new Uint8Array(image.rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
        const a = image.rgba[i + 3]! / 255;
        rgba[i] = Math.round(image.rgba[i]! * a + r * 255 * (1 - a));
        rgba[i + 1] = Math.round(image.rgba[i + 1]! * a + g * 255 * (1 - a));
        rgba[i + 2] = Math.round(image.rgba[i + 2]! * a + b * 255 * (1 - a));
        rgba[i + 3] = 255;
    }
    return { width: image.width, height: image.height, rgba };
}

export async function drawImageFile(path: string, read: ProjectFileReader, options: ImageFileOptions = {}): Promise<ImageFile> {
    const source = new TextDecoder().decode(await read(path));
    const recipe = parseRecipe(source);
    const files = new Map<string, ArrayBuffer>();
    await gatherRecipeFiles(recipeNeeds, source, async (need) => buffer(await read(need)), files, path);
    const job: RecipeJob = { source, files: {}, pictures: {} };
    for (const [need, bytes] of files) {
        if (isTextureRecipePath(need) || isFontFile(need)) job.files[need] = bytes;
        else job.pictures[need] = decodePicture(need, bytes);
    }
    let drawn: RgbaBitmap;
    let report: Pick<ImageFile, 'notes' | 'bounds' | 'covers' | 'layerBounds'> = { notes: [], bounds: null, covers: null, layerBounds: {} };
    try {
        if ('picture' in recipe) {
            const { picture } = await drawPicture(recipe.picture, job, NO_FONTS, 0);
            drawn = picture;
            report = { notes: picture.notes, bounds: picture.bounds, covers: picture.covers, layerBounds: picture.layerBounds };
        } else {
            const map = await drawRecipe(job, NO_FONTS);
            drawn = { width: map.width, height: map.height, rgba: map.pixels };
        }
    } catch (err) {
        if (err instanceof Error && err.message === NO_TEXT_CANVAS) throw new Error(`${path} sets text, and this command has no fonts to set it in: the editor draws it, or the device the game runs on`);
        throw err;
    }
    const { width, height } = drawn;
    if (options.on) drawn = layOn(drawn, options.on);
    if (options.zoom) drawn = zoomImage(drawn, options.zoom);
    return { png: encodeRgbaPng(drawn.width, drawn.height, drawn.rgba), width, height, ...report };
}
