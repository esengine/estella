// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Offscreen preview of posed skeletal geometry, owned by its handle.
 *
 *        Unlike a material ball, what is drawn here is not in any scene: the
 *        caller poses a skeleton itself and hands over the batches, which the
 *        engine copies and replays through the one skeletal path a frame's own
 *        geometry takes.
 *
 *        Everything names the handle. There is no current preview, no mode and
 *        no begin/end pair to get wrong, so two previews in flight cannot reach
 *        each other whatever order their calls arrive in — and a render CONSUMES
 *        what was handed over, so a frame that fails cannot draw last frame's
 *        pose again underneath the next one.
 */
import type { ESEngineModule } from '../wasm';
import { awaitReadback, READBACK_READY } from './readback';
import { withScratch } from '../wasm/wasmScratch';

export type SkeletalPreviewCore = Pick<ESEngineModule,
    'renderer_createSkeletalPreview' | 'renderer_submitSkeletalPreviewBatch'
    | 'renderer_renderSkeletalPreview' | 'renderer_pollSkeletalPreview'
    | 'renderer_getSkeletalPreviewPtr' | 'renderer_getSkeletalPreviewSize'
    | 'renderer_getSkeletalPreviewWidth' | 'renderer_getSkeletalPreviewHeight'
    | 'renderer_destroySkeletalPreview' | '_malloc' | '_free' | 'HEAPU8'>;

/** The connected core, when it answers the skeletal-preview surface. */
export function skeletalPreviewCore(m: unknown): SkeletalPreviewCore | null {
    const p = m as SkeletalPreviewCore | null;
    return typeof p?.renderer_createSkeletalPreview === 'function' ? p : null;
}

/** One batch of posed geometry, in the format every skeletal runtime emits. */
export interface SkeletalPreviewBatch {
    /** x,y,u,v,r,g,b,a per vertex. */
    vertices: Uint8Array;
    indices: Uint8Array;
    vertexCount: number;
    indexCount: number;
    textureId: number;
    blendMode: number;
    /** Column-major 4×4, as the renderer takes a model matrix. */
    transform: Float32Array;
    materialId?: number;
    layer?: number;
    depth?: number;
}

/**
 * An offscreen preview of one posed skeleton.
 *
 * Its lifetime is the caller's: whoever needs the preview to be alive holds
 * this, and `dispose` ends it. A disposed handle answers nothing rather than
 * quietly addressing whatever was made next.
 */
export class SkeletalPreview {
    private id: number;

    private constructor(private readonly core: SkeletalPreviewCore, id: number,
                        readonly width: number, readonly height: number) {
        this.id = id;
    }

    /** A preview of `w`×`h`, or null where this core has no such surface. */
    static create(module: unknown, w: number, h: number): SkeletalPreview | null {
        const core = skeletalPreviewCore(module);
        if (!core || w <= 0 || h <= 0) return null;
        const id = core.renderer_createSkeletalPreview(w, h);
        return id ? new SkeletalPreview(core, id, w, h) : null;
    }

    get live(): boolean {
        return this.id !== 0;
    }

    /** Hand over one batch. The engine copies it, so these buffers are the
     *  caller's again the moment this returns. */
    submit(batch: SkeletalPreviewBatch): boolean {
        if (!this.id) return false;
        const core = this.core;
        return withScratch({ _malloc: core._malloc, _free: core._free }, (alloc) => {
            const vp = alloc(batch.vertices.byteLength);
            const ip = alloc(batch.indices.byteLength);
            const tp = alloc(16 * 4);
            core.HEAPU8.set(batch.vertices, vp);
            core.HEAPU8.set(batch.indices, ip);
            core.HEAPU8.set(new Uint8Array(batch.transform.buffer, batch.transform.byteOffset, 16 * 4), tp);
            return core.renderer_submitSkeletalPreviewBatch(
                this.id, vp, batch.vertexCount, ip, batch.indexCount,
                batch.textureId, batch.blendMode, tp,
                batch.layer ?? 0, batch.depth ?? 0, batch.materialId ?? 0) !== 0;
        });
    }

    /**
     * Draw what has been handed over and resolve with the pixels, upright.
     *
     * Null when this preview already has a readback in flight — one at a time,
     * which is what keeps a landed image and the camera it was drawn with from
     * drifting apart. The caller re-renders when the pending one lands.
     */
    async render(viewProjection: Float32Array): Promise<ImageData | null> {
        if (!this.id) return null;
        const core = this.core;
        const started = withScratch({ _malloc: core._malloc, _free: core._free }, (alloc) => {
            const vp = alloc(16 * 4);
            core.HEAPU8.set(new Uint8Array(viewProjection.buffer, viewProjection.byteOffset, 16 * 4), vp);
            return core.renderer_renderSkeletalPreview(this.id, vp) !== 0;
        });
        if (!started) return null;
        if (await awaitReadback(() => core.renderer_pollSkeletalPreview(this.id)) !== READBACK_READY) {
            return null;
        }
        const size = core.renderer_getSkeletalPreviewSize(this.id);
        const w = core.renderer_getSkeletalPreviewWidth(this.id);
        const h = core.renderer_getSkeletalPreviewHeight(this.id);
        if (size === 0 || w === 0 || h === 0) return null;
        const pixels = new Uint8ClampedArray(core.HEAPU8.buffer, core.renderer_getSkeletalPreviewPtr(this.id), size);
        // Readback rows are bottom-up; flip so the preview is upright.
        const flipped = new Uint8ClampedArray(size);
        const rowBytes = w * 4;
        for (let y = 0; y < h; y++) {
            flipped.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), (h - 1 - y) * rowBytes);
        }
        return new ImageData(flipped, w, h);
    }

    /** End it. Idempotent, and the id stops answering rather than addressing
     *  whatever is made next. */
    dispose(): void {
        if (!this.id) return;
        this.core.renderer_destroySkeletalPreview(this.id);
        this.id = 0;
    }
}
