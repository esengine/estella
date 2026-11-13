// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  imageMaterial.ts: the SDK's surface maps (sdk/src/image), drawn with the pipeline's drawer of figures.
 */
import { renderMaterialMaps as render, type MaterialMaps } from '../../../sdk/src/image/imageMaterial';
import type { RgbaBitmap } from '../../../sdk/src/image/imageRaster';
import type { ImageSource } from '../../../sdk/src/image/imageSource';
import { FIGURE_DRAWER } from './imageFigure';

export * from '../../../sdk/src/image/imageMaterial';

/** The maps a source's surface draws, figures and all. */
export function renderMaterialMaps(source: ImageSource, color: RgbaBitmap, options: Parameters<typeof render>[2] = {}): MaterialMaps {
    return render(source, color, { figure: FIGURE_DRAWER, ...options });
}
