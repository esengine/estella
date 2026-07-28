// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Renderer } from './renderer';
import { requireResourceManager } from './resourceManager';

export const TextureFilter = {
    Nearest: 0,
    Linear: 1,
} as const;

export type TextureFilter = (typeof TextureFilter)[keyof typeof TextureFilter];

export const TextureWrap = {
    Repeat: 0,
    ClampToEdge: 1,
    MirroredRepeat: 2,
} as const;

export type TextureWrap = (typeof TextureWrap)[keyof typeof TextureWrap];

export function setTextureFilter(textureId: number, filter: TextureFilter): void {
    Renderer.setTextureParams(textureId, filter, filter, TextureWrap.ClampToEdge, TextureWrap.ClampToEdge);
}

export function setTextureWrap(textureId: number, wrap: TextureWrap): void {
    Renderer.setTextureParams(textureId, TextureFilter.Linear, TextureFilter.Linear, wrap, wrap);
}

export function setTextureParams(
    textureId: number,
    minFilter: TextureFilter,
    magFilter: TextureFilter,
    wrapS: TextureWrap,
    wrapT: TextureWrap,
): void {
    Renderer.setTextureParams(textureId, minFilter, magFilter, wrapS, wrapT);
}

/**
 * The texture's 9-slice border, in texture pixels from each edge. A property of
 * the IMAGE — every `UIVisual` set to NineSlice reads it, so a frame is sliced
 * once at import rather than re-typed on every entity that uses it. Normally
 * applied by the asset pipeline at load; call it directly to re-slice a texture
 * already resident (an authoring tool editing the border live).
 */
export function setTextureSliceBorder(
    textureId: number,
    left: number,
    right: number,
    top: number,
    bottom: number,
): void {
    requireResourceManager().setTextureMetadata(textureId, left, right, top, bottom);
}
