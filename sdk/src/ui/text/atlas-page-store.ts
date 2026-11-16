// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/atlas-page-store.ts
 * @brief   Engine-backed AtlasPageStore for the dynamic glyph atlas: a page is
 *          an RGBA8 GPU texture, glyphs land via the sub-region upload. The
 *          page id IS the texture handle, so the text
 *          renderer can pass it straight to submitTextBatch as the atlas texture.
 */
import { TextureContent, type ESEngineModule } from '../../wasm';
import { createTextureFromPixels, updateTextureSubregion } from '../../runtime/runtimeAssets';
import { provideTextureContent, requireResourceManager, textureRefill, withdrawTextureContent,
    evictTextureDimensions, getResourceManager, type TextureRefill } from '../../wasm/resourceManager';
import type { AtlasPageStore } from './glyph-atlas';

export class EngineAtlasPageStore implements AtlasPageStore {
    // pageId is the GL texture id (what the batch binds); uploads need the engine
    // handle, so keep the mapping.
    private readonly handleByGlId = new Map<number, { handle: number; refill: TextureRefill }>();
    private readonly owner = requireResourceManager();

    /** `module` is the wasm-heap marshalling vehicle; null on the native
     *  (embedded-Dawn) core, whose ResourceManager takes the bytes directly. */
    constructor(private readonly module: ESEngineModule | null) {}

    createPage(size: number, paint: (pixels: Uint8Array) => void, distance = false): number {
        const pixels = new Uint8Array(size * size * 4);
        const handle = createTextureFromPixels(
            this.module,
            { width: size, height: size, pixels },
            TextureContent.GlyphPage,
            /* flipY */ false,
            { filterMode: 'linear', wrapMode: 'clamp', srgb: !distance },
            this.owner,
        );
        // Repainting on demand instead of the device keeping a copy: a page is
        // 4 MiB of wasm heap at the default size, for an event most sessions never see.
        const refill: TextureRefill = () => {
            const page = new Uint8Array(size * size * 4);
            paint(page);
            updateTextureSubregion(this.module, handle, 0, 0, size, size, page, this.owner);
            return true;
        };
        provideTextureContent(handle, refill);
        // The batch binds by GL texture id (mirrors how spine resolves its atlas
        // pages); submitTextBatch gets this id as the page id.
        const glId = this.owner.getTextureGLId(handle);
        this.handleByGlId.set(glId, { handle, refill });
        return glId;
    }

    uploadSubRegion(pageId: number, x: number, y: number, w: number, h: number, pixels: Uint8Array): void {
        const handle = this.handleByGlId.get(pageId)?.handle;
        if (handle === undefined) return;
        updateTextureSubregion(this.module, handle, x, y, w, h, pixels, this.owner);
    }

    releasePage(pageId: number): void {
        const entry = this.handleByGlId.get(pageId);
        if (!entry) return;
        this.handleByGlId.delete(pageId);
        if (textureRefill(entry.handle) === entry.refill) withdrawTextureContent(entry.handle);
        if (getResourceManager() === this.owner) evictTextureDimensions(entry.handle);
        this.owner.releaseTexture(entry.handle);
    }
}
