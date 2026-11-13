// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Pictures drawn from their source: the raster an `.esimage` is drawn by, for a game that ships recipes in place of pixels.
 */
export { renderImage, type RenderedImage, type RgbaBitmap, type ImageFigureDrawer, type ImageTextDrawer, type FlatFigure } from './imageRaster';
export { validateImageSource, IMAGE_SOURCE_EXT, IMAGE_SOURCE_VERSION, MAX_IMAGE_SIZE, type ImageSource, type ImageLayer, type ImageMaterial } from './imageSource';
export { renderMaterialMaps, type MaterialMaps } from './imageMaterial';

export { IMAGE_RASTER_REVISION } from './imageRaster';

// Importing this subpath INSTALLS the drawer of texture recipes — see tilemap/index.ts.
import { IMAGE_RASTER_REVISION } from './imageRaster';
import { drawRecipe } from './recipeWorker';
import { RECIPE_WORKER_SOURCE } from './recipeWorkerBundle.generated';
import { setTextureRecipeRenderer, type RecipePixels } from '../asset/textureRecipe';
import { createJobPool, type JobPool } from '../runtime/jobs';

let pool: JobPool | null | undefined;
let next = 0;

// Drawn on a worker where the host has workers, so a game goes on drawing frames while its pictures are made; in place where it has
// none, or once the workers have failed (a recipe is still a texture then, only a slower one to load).
setTextureRecipeRenderer(async (source): Promise<RecipePixels> => {
    if (pool === undefined) pool = createJobPool(RECIPE_WORKER_SOURCE);
    if (pool) {
        try {
            return await pool.run<RecipePixels>(next++, { source });
        } catch (err) {
            // What the source itself is refused for is the answer; only a worker that cannot run sends the job back here.
            if (!/^(a job worker failed|the job workers have stopped|the job pool was disposed)/.test(err instanceof Error ? err.message : String(err))) throw err;
            pool = null;
        }
    }
    return drawRecipe(source);
}, IMAGE_RASTER_REVISION);
