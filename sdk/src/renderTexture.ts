// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Renderer, type RenderTargetHandle } from './renderer';
import { getResourceManager } from './resourceManager';

export interface RenderTextureOptions {
    width: number;
    height: number;
    depth?: boolean;
    filter?: 'nearest' | 'linear';
}

export interface RenderTextureHandle {
    _handle: RenderTargetHandle;
    /** Raw device texture id — for Draw.texture / low-level GL paths only. */
    textureId: number;
    /**
     * Resource-table handle for the color texture — what `Sprite.texture` /
     * `UIVisual.texture` consume (components resolve through the texture table;
     * a raw device id would fall back to the white texture). 0 when no resource
     * manager is live (headless renderer-only hosts).
     */
    texture: number;
    width: number;
    height: number;
    _depth: boolean;
    _filter: 'nearest' | 'linear';
}

export const RenderTexture = {
    create(options: RenderTextureOptions): RenderTextureHandle {
        const depth = options.depth ?? true;
        const linear = options.filter === 'linear';
        const flags = (depth ? 1 : 0) | (linear ? 2 : 0);

        const handle = Renderer.createRenderTarget(options.width, options.height, flags);
        const textureId = Renderer.getTargetTexture(handle);
        // Same channel video frames use: adopt the device texture into the
        // resource table so components can reference it by handle.
        const texture = textureId !== 0
            ? getResourceManager()?.registerExternalTexture(textureId, options.width, options.height) ?? 0
            : 0;

        return {
            _handle: handle,
            textureId,
            texture,
            width: options.width,
            height: options.height,
            _depth: depth,
            _filter: linear ? 'linear' : 'nearest',
        };
    },

    release(rt: RenderTextureHandle): void {
        if (rt.texture !== 0) getResourceManager()?.releaseTexture(rt.texture);
        Renderer.releaseRenderTarget(rt._handle);
    },

    resize(rt: RenderTextureHandle, width: number, height: number): RenderTextureHandle {
        Renderer.releaseRenderTarget(rt._handle);
        return RenderTexture.create({ width, height, depth: rt._depth, filter: rt._filter });
    },

    begin(rt: RenderTextureHandle, viewProjection: Float32Array): void {
        Renderer.begin(viewProjection, rt._handle);
    },

    end(): void {
        Renderer.end();
    },

    getDepthTexture(rt: RenderTextureHandle): number {
        return Renderer.getTargetDepthTexture(rt._handle);
    },
};
