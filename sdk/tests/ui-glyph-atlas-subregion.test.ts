/**
 * @file  REARCH_GUI P1.0 — the texture sub-region upload primitive that the
 *        dynamic glyph atlas (P1.1) builds on. The actual GL upload needs a GL
 *        context (covered later by the headless render host); here we verify the
 *        embind binding is registered on the C++ ResourceManager class, i.e. the
 *        Texture::updateSubRegion + rm_updateTextureSubregion wiring compiled and
 *        is reachable from TS.
 *
 *        getResourceManager() is null headless (no GL context), so we assert on
 *        the embind-bound class prototype rather than an instance.
 *
 *        Requires the built WASM SDK (build/wasm/web). Skips if absent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('REARCH_GUI P1.0: texture sub-region upload binding', () => {
    let proto: Record<string, unknown>;

    beforeAll(async () => {
        const module = await loadWasmModule();
        const RM = (module as unknown as { ResourceManager: { prototype: Record<string, unknown> } })
            .ResourceManager;
        proto = RM.prototype;
    });

    it('embind registers updateTextureSubregion on ResourceManager (alongside known methods)', () => {
        // Sanity: detection method is sound — a pre-existing binding is present.
        expect(typeof proto.setTextureMetadata).toBe('function');
        // The new P1.0 binding is registered.
        expect(typeof proto.updateTextureSubregion).toBe('function');
    });
});
