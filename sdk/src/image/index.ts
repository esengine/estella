// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Pictures drawn from their source: the raster an `.esimage` is drawn by, for a game that ships recipes in place of pixels.
 */
export { renderImage, type RenderedImage, type RgbaBitmap, type ImageTextDrawer, type FlatFigure } from './imageRaster';
export { validateImageSource, IMAGE_SOURCE_EXT, IMAGE_SOURCE_VERSION, MAX_IMAGE_SIZE, type ImageSource, type ImageLayer, type ImageMaterial } from './imageSource';
export { renderMaterialMaps, type MaterialMaps } from './imageMaterial';

export { parseRecipe, recipeNeeds, RECIPE_MAPS, type ImageMapSource, type RecipeMap } from './recipeSource';
export { canvasTextDrawer } from './imageText';
export { IMAGE_RASTER_REVISION } from './imageRaster';

// Importing this subpath INSTALLS the drawer of texture recipes — see tilemap/index.ts.
import { IMAGE_RASTER_REVISION } from './imageRaster';
import { drawRecipe, NO_TEXT_CANVAS, type DrawnRecipe, type RecipeHost, type RecipeJob } from './recipeWorker';
import { RECIPE_WORKER_SOURCE } from './recipeWorkerBundle.generated';
import { isFontFile, recipeNeeds } from './recipeSource';
import { decodeImagePixels } from '../asset/imageDecode';
import { decodePngData } from '../asset/pngData';
import { isTextureRecipePath, setTextureRecipeDrawer, type TextureRecipeDrawer } from '../asset/textureRecipe';
import { getPlatform, platformCreateCanvas } from '../platform/base';
import { createJobs, type Jobs } from '../runtime/jobs';

let jobs: Jobs<RecipeJob, DrawnRecipe> | undefined;
let next = 0;

/** The game's own thread as a place to draw: the platform's canvas, and its way of making a font file a family. */
const HERE: RecipeHost = {
    canvas: (w, h) => {
        try {
            return platformCreateCanvas(w, h);
        } catch {
            throw new Error('a picture with text needs a 2D canvas to draw it, and this host has none: bake it to its .png');
        }
    },
    async font(family, bytes) {
        const register = getPlatform().registerFont;
        if (!register) throw new Error('a picture set in a font file needs a host that takes font files, and this one does not: bake it to its .png');
        await register.call(getPlatform(), family, bytes);
    },
};

/** An image file's pixels as stored, for a recipe that lays the picture in. */
async function decoded(path: string, bytes: ArrayBuffer): Promise<DrawnRecipe> {
    const png = await decodePngData(new Uint8Array(bytes));
    if (png) return { width: png.width, height: png.height, pixels: png.pixels };
    if (typeof createImageBitmap !== 'function' || typeof Blob === 'undefined') throw new Error(`${path} is laid in a recipe and is not a PNG this host can read`);
    const image = await decodeImagePixels(new Blob([bytes]));
    return { width: image.width, height: image.height, pixels: image.pixels };
}

// Drawn on a worker where the host has workers, so a game goes on drawing frames while its pictures are made; here, a picture per turn
// of the frame's budget, where it has none, once the workers have failed, or for text where a worker has no canvas (a recipe is still a
// texture then, a slower one to load).
const DRAWER: TextureRecipeDrawer = {
    revision: IMAGE_RASTER_REVISION,
    needs: recipeNeeds,
    async draw(source, files): Promise<DrawnRecipe> {
        const job: RecipeJob = { source, files: {}, pictures: {} };
        for (const [path, bytes] of files) {
            if (isTextureRecipePath(path) || isFontFile(path)) job.files[path] = bytes;
            else job.pictures[path] = await decoded(path, bytes);
        }
        jobs ??= createJobs<RecipeJob, DrawnRecipe>({
            name: 'image', script: RECIPE_WORKER_SOURCE, here: (j) => drawRecipe(j, HERE),
            // Text is drawn on a canvas, and a worker may have none: that picture is drawn here.
            doHere: (e) => e.message === NO_TEXT_CANVAS,
        });
        return jobs.run(job, { affinity: next++ });
    },
};

/** Installs the drawer of texture recipes: what importing this module does, and a way back for whoever took it out. */
export function installTextureRecipes(): void {
    setTextureRecipeDrawer(DRAWER);
}

installTextureRecipes();
