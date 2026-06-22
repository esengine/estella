/**
 * @file    ui/text/sdf.ts
 * @brief   TS wrapper over the engine's C++ 8SSEDT signed-distance-field
 *          generator (REARCH_GUI P1). The dynamic glyph atlas rasterizes a
 *          glyph to alpha via Canvas2D, then calls this to get an SDF that
 *          stays crisp at any scale and supports cheap outline/shadow.
 */
import type { ESEngineModule } from '../../wasm';
import { withScratch } from '../../wasmScratch';

/**
 * Convert a tight `width*height` alpha coverage buffer to a single-channel SDF.
 * 128 encodes the edge; >128 inside, <128 outside, with `spread` pixels mapped
 * to half the byte range. Returns a fresh `width*height` Uint8Array, or `null`
 * when the engine build lacks the binding (caller falls back to a plain-alpha
 * atlas — see REARCH_GUI §7.6).
 */
export function sdfFromAlpha(
    module: ESEngineModule,
    alpha: Uint8Array,
    width: number,
    height: number,
    spread: number,
): Uint8Array | null {
    if (!module.sdfFromAlpha) return null;
    const n = width * height;
    if (n === 0 || alpha.length < n) return null;

    const out = new Uint8Array(n);
    withScratch(module, alloc => {
        const alphaPtr = alloc(n);
        const outPtr = alloc(n);
        module.HEAPU8.set(alpha.subarray(0, n), alphaPtr);
        module.sdfFromAlpha!(alphaPtr, outPtr, width, height, spread);
        // Copy out before the scratch buffers are freed on return.
        out.set(module.HEAPU8.subarray(outPtr, outPtr + n));
    });
    return out;
}
