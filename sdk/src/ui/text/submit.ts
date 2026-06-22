/**
 * @file    ui/text/submit.ts
 * @brief   TS → engine submission for pre-laid-out SDF glyph quads (REARCH_GUI
 *          P1.3). The text system lays glyphs out against the dynamic atlas in
 *          TS, then hands the batch here; the engine routes it through the SDF
 *          batch-shader variant. Mirrors the proven spine mesh-submit path.
 */
import type { ESEngineModule } from '../../wasm';
import { withScratch } from '../../wasmScratch';

/** Floats per glyph vertex: position(2) + uv(2) + color(4). */
export const TEXT_VERTEX_FLOATS = 8;

/**
 * Submit a batch of glyph quads. `vertices` is `TEXT_VERTEX_FLOATS` floats per
 * vertex (x,y,u,v,r,g,b,a); `indices` reference those vertices; `transform` is a
 * column-major mat4 applied to vertex positions (pass identity if positions are
 * already world-space). No-op if the engine build lacks the binding.
 */
export function submitTextBatch(
    module: ESEngineModule,
    vertices: Float32Array,
    indices: Uint16Array,
    textureId: number,
    transform: Float32Array,
    entity: number,
    layer: number,
    depth: number,
): void {
    if (!module.renderer_submitTextBatch) return;
    const vertexCount = (vertices.length / TEXT_VERTEX_FLOATS) | 0;
    if (vertexCount <= 0 || indices.length <= 0 || transform.length < 16) return;

    // Copy through HEAPU8 (the one heap view emscripten reliably exports here)
    // as raw bytes; _malloc is ≥8-byte aligned so the C++ f32/u16 reads are fine.
    const vBytes = new Uint8Array(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const iBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
    const tBytes = new Uint8Array(transform.buffer, transform.byteOffset, 16 * 4);
    withScratch(module, alloc => {
        const vPtr = alloc(vBytes.byteLength);
        const iPtr = alloc(iBytes.byteLength);
        const tPtr = alloc(tBytes.byteLength);
        module.HEAPU8.set(vBytes, vPtr);
        module.HEAPU8.set(iBytes, iPtr);
        module.HEAPU8.set(tBytes, tPtr);
        module.renderer_submitTextBatch!(
            vPtr, vertexCount, iPtr, indices.length, textureId, tPtr, entity, layer, depth,
        );
    });
}
