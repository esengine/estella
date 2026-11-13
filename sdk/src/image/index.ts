// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Pictures drawn from their source: the raster an `.esimage` is drawn by, for a game that ships recipes in place of pixels.
 */
export { renderImage, type RenderedImage, type RgbaBitmap, type ImageFigureDrawer, type ImageTextDrawer, type FlatFigure } from './imageRaster';
export { validateImageSource, IMAGE_SOURCE_EXT, IMAGE_SOURCE_VERSION, MAX_IMAGE_SIZE, type ImageSource, type ImageLayer, type ImageMaterial } from './imageSource';
export { renderMaterialMaps, type MaterialMaps } from './imageMaterial';

// Importing this subpath INSTALLS the drawer of texture recipes — see tilemap/index.ts.
import { renderImage } from './imageRaster';
import { validateImageSource } from './imageSource';
import { setTextureRecipeRenderer } from '../asset/textureRecipe';

setTextureRecipeRenderer((source) => {
    const picture = renderImage(validateImageSource(JSON.parse(source)));
    return { width: picture.width, height: picture.height, pixels: picture.rgba };
});
