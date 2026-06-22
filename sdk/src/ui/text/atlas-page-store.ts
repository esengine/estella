/**
 * @file    ui/text/atlas-page-store.ts
 * @brief   Engine-backed AtlasPageStore for the dynamic glyph atlas (REARCH_GUI
 *          P1.3): a page is an RGBA8 GPU texture, glyphs land via the P1.0
 *          sub-region upload. The page id IS the texture handle, so the text
 *          renderer can pass it straight to submitTextBatch as the atlas texture.
 */
import type { ESEngineModule } from '../../wasm';
import { createTextureFromPixels, updateTextureSubregion } from '../../runtimeAssets';
import type { AtlasPageStore } from './glyph-atlas';

export class EngineAtlasPageStore implements AtlasPageStore {
    constructor(private readonly module: ESEngineModule) {}

    createPage(size: number): number {
        // Blank (transparent) RGBA8 page; linear filtering keeps SDF text smooth
        // when scaled, clamp avoids edge bleed at the page border.
        const pixels = new Uint8Array(size * size * 4);
        return createTextureFromPixels(
            this.module,
            { width: size, height: size, pixels },
            /* flipY */ false,
            { filterMode: 'linear', wrapMode: 'clamp' },
        );
    }

    uploadSubRegion(pageId: number, x: number, y: number, w: number, h: number, pixels: Uint8Array): void {
        updateTextureSubregion(this.module, pageId, x, y, w, h, pixels);
    }
}
