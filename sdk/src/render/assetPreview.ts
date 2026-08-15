// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Offscreen thumbnails of an asset, through the engine's own render path.
 *        A material ball and a mesh differ by ONE call; what follows — readback,
 *        pixels, row flip — is shared, since a second copy of it is a second
 *        place for the row order to be wrong.
 */
import type { ESEngineModule } from '../wasm';
import { awaitReadback, READBACK_READY } from './readback';

/**
 * The preview slice: one draw entry per asset kind plus the readback. Narrowed from
 * the wasm module rather than required of every core — the readback pointer has no
 * native wrapper, so a host without it is checked for at the call.
 */
export type PreviewCore = Pick<ESEngineModule,
    'renderer_renderMaterialPreview' | 'renderer_renderMeshPreview' | 'renderer_pollPreviewReadback'
    | 'renderer_getPreviewSize' | 'renderer_getPreviewWidth'
    | 'renderer_getPreviewHeight' | 'renderer_getPreviewPtr' | 'HEAPU8'>;

/** The connected core, when it answers the preview surface; null otherwise. */
export function previewCore(m: unknown): PreviewCore | null {
    const p = m as PreviewCore | null;
    return typeof p?.renderer_renderMaterialPreview === 'function' ? p : null;
}

/**
 * Run @p draw against the offscreen target and resolve with its pixels. The
 * readback rides the engine's async seam: immediate on GL, resolved when the
 * staging-buffer map lands on WebGPU — one awaited call either way.
 */
export async function drawPreview(m: PreviewCore, draw: () => void): Promise<ImageData | null> {
    draw();
    if (await awaitReadback(() => m.renderer_pollPreviewReadback()) !== READBACK_READY) return null;
    const size = m.renderer_getPreviewSize();
    const w = m.renderer_getPreviewWidth();
    const h = m.renderer_getPreviewHeight();
    if (size === 0 || w === 0 || h === 0) return null;
    const pixels = new Uint8ClampedArray(m.HEAPU8.buffer, m.renderer_getPreviewPtr(), size);
    // Readback rows are bottom-up; flip so the thumbnail is upright.
    const flipped = new Uint8ClampedArray(size);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
        flipped.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), (h - 1 - y) * rowBytes);
    }
    return new ImageData(flipped, w, h);
}

/**
 * A thumbnail of a loaded `.esmesh`, seen from off-axis and framed to its own
 * bounds — a mesh is authored at whatever scale its source used, and head-on it
 * is a silhouette. Null if the engine isn't ready or the mesh isn't loaded.
 */
export async function renderMeshPreview(
    module: unknown, mesh: number, w: number, h: number,
): Promise<ImageData | null> {
    const m = previewCore(module);
    if (!m || typeof m.renderer_renderMeshPreview !== 'function' || !mesh) return null;
    return drawPreview(m, () => m.renderer_renderMeshPreview(mesh, w, h));
}
