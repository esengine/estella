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
    'renderer_renderMaterialPreview' | 'renderer_renderMeshPreview' | 'renderer_setPreviewOrbit' | 'renderer_pollPreviewReadback'
    | 'renderer_getPreviewSize' | 'renderer_getPreviewWidth'
    | 'renderer_getPreviewHeight' | 'renderer_getPreviewPtr' | 'HEAPU8'>;

/** Where a preview is seen from, degrees: yaw about up, pitch above the horizon. @experimental */
export interface PreviewOrbit { yaw: number; pitch: number }

/** The angle a preview is seen from unless one is given: off-axis, above and to the right. @experimental */
export const DEFAULT_PREVIEW_ORBIT: PreviewOrbit = { yaw: 30.96, pitch: 21.1 };

/** Set the angle the preview about to be drawn is seen from: every draw sets it, so one turned preview leaves no other turned. */
export function aimPreview(m: PreviewCore, orbit: PreviewOrbit | undefined): void {
    const o = orbit ?? DEFAULT_PREVIEW_ORBIT;
    m.renderer_setPreviewOrbit?.(o.yaw, o.pitch);
}

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
const previewTails = new WeakMap<PreviewCore, Promise<void>>();

export function drawPreview(m: PreviewCore, draw: () => void, signal?: AbortSignal): Promise<ImageData | null> {
    if (signal?.aborted) return Promise.resolve(null);
    // Draw, poll and copy own one shared buffer as a single operation. Even a
    // ready GL readback yields at await, so a second draw must wait for the copy.
    const result = (previewTails.get(m) ?? Promise.resolve()).then(() => readPreview(m, draw, signal));
    const tail = result.then(() => {}, () => {});
    previewTails.set(m, tail);
    void tail.then(() => { if (previewTails.get(m) === tail) previewTails.delete(m); });
    return result;
}

async function readPreview(m: PreviewCore, draw: () => void, signal?: AbortSignal): Promise<ImageData | null> {
    // An owner can disappear while waiting for another preview's readback.
    // Skip both draw and poll, rather than return the previous task's pixels.
    if (signal?.aborted) return null;
    const submitted: unknown = draw();
    if (submitted === false) return null;
    if (await awaitReadback(() => m.renderer_pollPreviewReadback()) !== READBACK_READY) return null;
    // Drain a submitted transfer before releasing the shared surface, even if its pixels are obsolete.
    if (signal?.aborted) return null;
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
 * A thumbnail of a loaded `.esmesh`, seen from off-axis (or from `orbit`) and framed to its own
 * bounds — a mesh is authored at whatever scale its source used, and head-on it
 * is a silhouette. Null if the engine isn't ready or the mesh isn't loaded.
 */
export async function renderMeshPreview(
    module: unknown, mesh: number, w: number, h: number, orbit?: PreviewOrbit,
): Promise<ImageData | null> {
    const m = previewCore(module);
    if (!m || typeof m.renderer_renderMeshPreview !== 'function' || !mesh) return null;
    return drawPreview(m, () => { aimPreview(m, orbit); return m.renderer_renderMeshPreview(mesh, w, h); });
}

/** One mesh of a preview made of several, and the material it is drawn with. @experimental */
export interface PreviewDraw { mesh: number; material: number }

/**
 * Several meshes, each with its own material, in one picture framed to all of them: an asset drawn as more than one mesh (a
 * groom's groups) seen whole, from off-axis or from `orbit`. Null if the engine has no such preview or draws nothing.
 * @experimental
 */
export async function renderMeshSetPreview(
    module: unknown, draws: readonly PreviewDraw[], w: number, h: number, orbit?: PreviewOrbit,
): Promise<ImageData | null> {
    const m = previewCore(module) as (PreviewCore & {
        renderer_renderMeshSetPreview?(meshes: number, materials: number, count: number, w: number, h: number): void;
        _malloc?(n: number): number; _free?(p: number): void; HEAPU32?: Uint32Array;
    }) | null;
    const live = draws.filter((d) => d.mesh !== 0);
    if (!m || typeof m.renderer_renderMeshSetPreview !== 'function' || !m._malloc || !m._free || live.length === 0) return null;
    const malloc = m._malloc, free = m._free;
    return drawPreview(m, () => {
        const bytes = live.length * 4;
        const meshes = malloc(bytes), materials = malloc(bytes);
        try {
            const heap = new Uint32Array(m.HEAPU8.buffer);
            live.forEach((d, i) => { heap[(meshes >>> 2) + i] = d.mesh; heap[(materials >>> 2) + i] = d.material; });
            aimPreview(m, orbit);
            m.renderer_renderMeshSetPreview!(meshes, materials, live.length, w, h);
        } finally { free(meshes); free(materials); }
    });
}
