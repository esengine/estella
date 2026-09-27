// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Runtime side of the Basis Universal KTX2 transcoder.
 *
 * Loads the standalone `basis` wasm module (built like spine/physics) and adapts
 * its C API to the {@link BasisTranscoder} seam consumed by the texture loader.
 * Marshalling mirrors the physics module: copy the KTX2 bytes into the module's
 * heap, transcode into a module-allocated buffer, copy the result back out.
 */
import type { BasisTranscoder, TranscodeResult, RgbaResult, TranscodedLevel } from './compressed';
import { CompressedTextureFormat } from './compressed';

/** Numeric format contract shared with BasisModuleEntry.cpp::mapFormat. */
const FORMAT_CODE: Record<CompressedTextureFormat, number> = {
    [CompressedTextureFormat.ETC2_RGBA8]: 0,
    [CompressedTextureFormat.ASTC_4x4]: 1,
    [CompressedTextureFormat.S3TC_DXT5]: 2,
};
const RGBA_CODE = 3;

/** The subset of the emscripten `basis` module instance we call into. */
export interface BasisWasmModule {
    _es_basis_init(): void;
    _es_basis_open(ptr: number, len: number): number;
    _es_basis_get_width(): number;
    _es_basis_get_height(): number;
    _es_basis_transcoded_size(target: number): number;
    _es_basis_transcode(target: number, outPtr: number, outLen: number): number;
    /** Per-level API; a module built before it transcodes level 0 only. */
    _es_basis_level_count?(): number;
    _es_basis_level_width?(level: number): number;
    _es_basis_level_height?(level: number): number;
    _es_basis_level_size?(target: number, level: number): number;
    _es_basis_transcode_level?(target: number, level: number, outPtr: number, outLen: number): number;
    _es_basis_close(): void;
    _malloc(size: number): number;
    _free(ptr: number): void;
    /** Live heap view — re-read on every access (ALLOW_MEMORY_GROWTH may detach it). */
    readonly HEAPU8: Uint8Array;
}

export type BasisModuleFactory = (opts?: Record<string, unknown>) => Promise<BasisWasmModule>;

/** Instantiate the basis module and initialize its transcoder tables. */
export async function loadBasisModule(factory: BasisModuleFactory): Promise<BasisWasmModule> {
    const mod = await factory();
    mod._es_basis_init();
    return mod;
}

/** Adapts a loaded basis wasm module to the {@link BasisTranscoder} interface. */
export class BasisTranscoderImpl implements BasisTranscoder {
    constructor(private readonly mod: BasisWasmModule) {}

    transcode(ktx2: Uint8Array, target: CompressedTextureFormat): TranscodeResult | null {
        return this.run_(ktx2, FORMAT_CODE[target]);
    }

    transcodeToRgba(ktx2: Uint8Array): RgbaResult | null {
        return this.run_(ktx2, RGBA_CODE);
    }

    private run_(ktx2: Uint8Array, code: number): TranscodeResult | null {
        const mod = this.mod;
        const inPtr = mod._malloc(ktx2.length);
        if (!inPtr) return null;
        try {
            mod.HEAPU8.set(ktx2, inPtr);
            if (!mod._es_basis_open(inPtr, ktx2.length)) return null;
            try {
                const perLevel = typeof mod._es_basis_transcode_level === 'function';
                const count = perLevel ? Math.max(1, mod._es_basis_level_count!()) : 1;
                const levels: TranscodedLevel[] = [];
                for (let level = 0; level < count; level++) {
                    const width = perLevel ? mod._es_basis_level_width!(level) : mod._es_basis_get_width();
                    const height = perLevel ? mod._es_basis_level_height!(level) : mod._es_basis_get_height();
                    const size = perLevel ? mod._es_basis_level_size!(code, level) : mod._es_basis_transcoded_size(code);
                    const data = size > 0 ? this.transcodeLevel_(code, level, size, perLevel) : null;
                    // A chain that stops early is still a chain: keep the levels
                    // that came out, and the base level is the one that must.
                    if (!data) {
                        if (level === 0) return null;
                        break;
                    }
                    levels.push({ width, height, data });
                }
                return { width: levels[0].width, height: levels[0].height, data: levels[0].data, levels };
            } finally {
                mod._es_basis_close();
            }
        } finally {
            mod._free(inPtr);
        }
    }

    private transcodeLevel_(code: number, level: number, size: number, perLevel: boolean): Uint8Array | null {
        const mod = this.mod;
        const outPtr = mod._malloc(size);
        if (!outPtr) return null;
        try {
            const ok = perLevel
                ? mod._es_basis_transcode_level!(code, level, outPtr, size)
                : mod._es_basis_transcode(code, outPtr, size);
            // .slice() copies out of the wasm heap into a standalone buffer.
            return ok ? mod.HEAPU8.slice(outPtr, outPtr + size) : null;
        } finally {
            mod._free(outPtr);
        }
    }
}

/** Convenience: load the module and wrap it as a {@link BasisTranscoder}. */
export async function createBasisTranscoder(factory: BasisModuleFactory): Promise<BasisTranscoder> {
    return new BasisTranscoderImpl(await loadBasisModule(factory));
}

/**
 * Adapt an already-instantiated basis module (acquired through the realm's
 * {@link SideModuleHost}.acquire('basis')) to the {@link BasisTranscoder} seam.
 * Inits the transcoder tables (idempotent) and wraps the module — the bridge the
 * texture loaders use so KTX2 assets transcode on demand, the same way physics /
 * spine modules are acquired.
 */
export function transcoderFromModule(mod: BasisWasmModule): BasisTranscoder {
    mod._es_basis_init();
    return new BasisTranscoderImpl(mod);
}
