// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    image.ts
 * @brief   Public `wx*` image helpers — thin back-compat wrappers binding the
 *          WeChat global to the vendor-neutral family image decode
 *          (../minigame/image.ts). Retained as part of `esengine/wechat`.
 */

/// <reference types="minigame-api-typings" />

import type { MiniGameGlobal, MiniGameImage } from '../minigame';
import { mgLoadImage, mgGetImagePixels, mgLoadImagePixels } from '../minigame';
import type { ImageLoadResult } from '../types';

export type { ImageLoadResult };

function g(): MiniGameGlobal {
    return wx as unknown as MiniGameGlobal;
}

export function wxLoadImage(path: string): Promise<MiniGameImage> {
    return mgLoadImage(g(), path);
}

export function wxGetImagePixels(img: MiniGameImage): ImageLoadResult {
    return mgGetImagePixels(g(), img);
}

export function wxLoadImagePixels(path: string): Promise<ImageLoadResult> {
    return mgLoadImagePixels(g(), path);
}
