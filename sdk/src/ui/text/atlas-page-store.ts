// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/atlas-page-store.ts
 * @brief   Engine-backed AtlasPageStore for the dynamic glyph atlas: a page is
 *          an RGBA8 GPU texture, glyphs land via the sub-region upload. The
 *          page id IS the texture handle, so the text
 *          renderer can pass it straight to submitTextBatch as the atlas texture.
 */
import type { ESEngineModule } from '../../wasm';
import { createTextureFromPixels, updateTextureSubregion } from '../../runtimeAssets';
import { requireResourceManager } from '../../resourceManager';
import type { AtlasPageStore } from './glyph-atlas';

export class EngineAtlasPageStore implements AtlasPageStore {
    // pageId is the GL texture id (what the batch binds); uploads need the engine
    // handle, so keep the mapping.
    private readonly handleByGlId = new Map<number, number>();

    constructor(private readonly module: ESEngineModule) {}

    createPage(size: number): number {
        // Blank (transparent) RGBA8 page; linear filtering keeps SDF text smooth
        // when scaled, clamp avoids edge bleed at the page border.
        const pixels = new Uint8Array(size * size * 4);
        const handle = createTextureFromPixels(
            this.module,
            { width: size, height: size, pixels },
            /* flipY */ false,
            { filterMode: 'linear', wrapMode: 'clamp' },
        );
        // The batch binds by GL texture id (mirrors how spine resolves its atlas
        // pages); submitTextBatch gets this id as the page id.
        const glId = requireResourceManager().getTextureGLId(handle);
        this.handleByGlId.set(glId, handle);
        return glId;
    }

    uploadSubRegion(pageId: number, x: number, y: number, w: number, h: number, pixels: Uint8Array): void {
        const handle = this.handleByGlId.get(pageId) ?? pageId;
        updateTextureSubregion(this.module, handle, x, y, w, h, pixels);
    }
}
