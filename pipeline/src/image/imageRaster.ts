// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  imageRaster.ts: the SDK's raster (sdk/src/image), with the pipeline's own drawer of figures handed to every picture it renders.
 */
import { renderImage as render, type RenderedImage } from '../../../sdk/src/image/imageRaster';
import type { ImageSource } from '../../../sdk/src/image/imageSource';
import { FIGURE_DRAWER } from './imageFigure';

export * from '../../../sdk/src/image/imageRaster';

/** The picture a source draws, figures and all. */
export function renderImage(source: ImageSource, options: Parameters<typeof render>[1] = {}): RenderedImage {
    return render(source, { figure: FIGURE_DRAWER, ...options });
}
