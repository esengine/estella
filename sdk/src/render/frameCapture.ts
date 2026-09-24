// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ESEngineModule } from '../wasm';
import { awaitReadback, READBACK_READY } from './readback';

/**
 * Memory-safety model for this module
 * -----------------------------------
 *
 * Every function here reads from WASM-owned memory and returns values the
 * caller may hold across later frames. To stay safe when WASM memory grows
 * or the renderer reuses its capture buffer, we never return a typed array
 * that views the WASM heap — we copy primitives into fresh JS objects /
 * buffers before returning.
 *
 *   - decodeFrameCapture copies every field out as plain `number`s and
 *     numeric arrays. The intermediate `DataView` and `Uint32Array` views
 *     are local and dropped as soon as the function returns.
 *   - getSnapshotImageData reads pixel rows from the heap view into a
 *     freshly-allocated `Uint8ClampedArray` ("flipped") and wraps that
 *     JS-owned buffer in the returned ImageData.
 *
 * Do NOT "optimize" either function by returning a heap-backed typed array
 * directly — a subsequent WASM alloc/grow would detach it or the renderer
 * would overwrite the bytes on the next capture, handing the caller silent
 * corruption.
 */

/**
 * Why a draw call started rather than joining the one before it. Mirrors the
 * engine's BatchBreak; each member is a condition the merge itself tests.
 */
export enum BatchBreak {
    None = 0,
    RunStart = 1,
    Instanced = 2,
    Shader = 3,
    Blend = 4,
    Layout = 5,
    Material = 6,
    Depth = 7,
    Cull = 8,
    State = 9,
    Scissor = 10,
    Stencil = 11,
    IndexGap = 12,
    TextureSlots = 13,
}

export enum RenderType {
    Sprite = 0,
    Spine = 1,
    Mesh = 2,
    ExternalMesh = 3,
    Text = 4,
    Particle = 5,
    Shape = 6,
    UIElement = 7,
}

/** What a pass of the frame draws: a camera's scene, or the screen-space overlay. */
export enum CapturePass {
    Scene = 0,
    Overlay = 1,
}

export interface DrawCallInfo {
    index: number;
    /** Which pass of the frame drew it, in the order the passes ran. */
    pass: number;
    passKind: CapturePass;
    stage: number;
    type: RenderType;
    blendMode: number;
    textureId: number;
    materialId: number;
    shaderId: number;
    indexCount: number;
    /** 0 for a draw that is not instanced. */
    instanceCount: number;
    triangleCount: number;
    layer: number;
    breakReason: BatchBreak;
    scissorX: number;
    scissorY: number;
    scissorW: number;
    scissorH: number;
    scissorEnabled: boolean;
    stencilWrite: boolean;
    stencilTest: boolean;
    stencilRef: number;
    textureSlotUsage: number;
    /** Every texture the draw bound, slot 0 first; `textureId` is the first. */
    textures: number[];
    /** The entities the draw was made from, in draw order; an item with no entity
     *  (a glyph run, a gizmo) is not listed. */
    entities: number[];
}

export interface FrameCaptureData {
    drawCalls: DrawCallInfo[];
    passCount: number;
}

/** sizeof(DrawCallRecord) in FrameCapture.hpp, which asserts the offsets read here. */
const RECORD_SIZE_BYTES = 84;

export function decodeFrameCapture(module: ESEngineModule): FrameCaptureData | null {
    if (!module.renderer_hasCapturedData()) return null;

    const count = module.renderer_getCapturedFrameSize();
    if (count === 0) return null;

    const dataPtr = module.renderer_getCapturedFrameData();
    const entitiesPtr = module.renderer_getCapturedEntities();
    const entityCount = module.renderer_getCapturedEntityCount();
    const passCount = module.renderer_getCapturedPassCount();

    const heap = module.HEAPU8;
    const view = new DataView(heap.buffer, dataPtr, count * RECORD_SIZE_BYTES);
    const entityHeap = new Uint32Array(heap.buffer, entitiesPtr, entityCount);
    const textureCount = module.renderer_getCapturedTextureCount();
    const textureHeap = new Uint32Array(heap.buffer, module.renderer_getCapturedTextures(), textureCount);

    const drawCalls: DrawCallInfo[] = [];
    for (let i = 0; i < count; i++) {
        const off = i * RECORD_SIZE_BYTES;
        const listed = view.getUint32(off + 32, true);
        const entityOffset = view.getUint32(off + 36, true);
        const entities: number[] = [];
        for (let e = 0; e < listed && entityOffset + e < entityCount; e++) {
            entities.push(entityHeap[entityOffset + e]);
        }
        const slots = view.getUint8(off + 72);
        const textureOffset = view.getUint32(off + 80, true);
        const textures: number[] = [];
        for (let t = 0; t < slots && textureOffset + t < textureCount; t++) textures.push(textureHeap[textureOffset + t]);
        drawCalls.push({
            index: view.getUint32(off, true),
            pass: view.getUint32(off + 4, true),
            stage: view.getUint8(off + 8),
            type: view.getUint8(off + 9) as RenderType,
            blendMode: view.getUint8(off + 10),
            passKind: view.getUint8(off + 11) as CapturePass,
            textureId: view.getUint32(off + 12, true),
            materialId: view.getUint32(off + 16, true),
            shaderId: view.getUint32(off + 20, true),
            indexCount: view.getUint32(off + 24, true),
            triangleCount: view.getUint32(off + 28, true),
            layer: view.getInt32(off + 40, true),
            breakReason: view.getUint8(off + 44) as BatchBreak,
            scissorX: view.getInt32(off + 48, true),
            scissorY: view.getInt32(off + 52, true),
            scissorW: view.getInt32(off + 56, true),
            scissorH: view.getInt32(off + 60, true),
            scissorEnabled: view.getUint8(off + 64) !== 0,
            stencilWrite: view.getUint8(off + 65) !== 0,
            stencilTest: view.getUint8(off + 66) !== 0,
            stencilRef: view.getInt32(off + 68, true),
            textureSlotUsage: slots,
            textures,
            instanceCount: view.getUint32(off + 76, true),
            entities,
        });
    }

    return { drawCalls, passCount };
}

/**
 * Asks for the captured frame's draws up to @p drawCallIndex. The engine replays
 * them on a later frame, right after the pass that drew them, so frames have to
 * keep rendering until {@link getSnapshotImageData} resolves.
 */
export function replayToDrawCall(module: ESEngineModule, drawCallIndex: number): void {
    module.renderer_replayToDrawCall(drawCallIndex);
}

/** Whether the replayed pass made as many draws as the capture did; false means
 *  the scene changed since, and the snapshot shows the later frame. */
export function snapshotMatchesCapture(module: ESEngineModule): boolean {
    return module.renderer_snapshotMatchesCapture();
}

/**
 * Resolves with the replay snapshot's pixels once its readback lands (the async
 * seam: immediate on GL, a later event-loop turn on WebGPU). Null when no
 * snapshot is in flight or the readback failed.
 */
export async function getSnapshotImageData(module: ESEngineModule): Promise<ImageData | null> {
    if (await awaitReadback(() => module.renderer_pollSnapshotReadback()) !== READBACK_READY) {
        return null;
    }
    const size = module.renderer_getSnapshotSize();
    if (size === 0) return null;

    const w = module.renderer_getSnapshotWidth();
    const h = module.renderer_getSnapshotHeight();
    if (w === 0 || h === 0) return null;

    const ptr = module.renderer_getSnapshotPtr();
    const heap = module.HEAPU8;
    const pixels = new Uint8ClampedArray(heap.buffer, ptr, size);

    const flipped = new Uint8ClampedArray(size);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
        const srcOff = y * rowBytes;
        const dstOff = (h - 1 - y) * rowBytes;
        flipped.set(pixels.subarray(srcOff, srcOff + rowBytes), dstOff);
    }

    return new ImageData(flipped, w, h);
}

/** A frame renders before this resolves: a live loop's next animation frame, or a driver's step. */
export type NextFrame = () => Promise<void>;

/**
 * Captures the next whole frame, every pass of it. Null when @p maxFrames frames
 * rendered and none of them drew anything.
 */
export async function captureFrame(
    module: ESEngineModule, nextFrame: NextFrame, maxFrames = 8,
): Promise<FrameCaptureData | null> {
    module.renderer_captureNextFrame();
    for (let i = 0; i < maxFrames; i++) {
        await nextFrame();
        const data = decodeFrameCapture(module);
        if (data) return data;
    }
    return null;
}

export interface ReplaySnapshot {
    image: ImageData;
    /** See {@link snapshotMatchesCapture}. */
    matchesCapture: boolean;
}

/** The captured frame's pass, drawn up to and including draw @p drawCallIndex. */
export async function replayDraw(
    module: ESEngineModule, drawCallIndex: number, nextFrame: NextFrame, maxFrames = 8,
): Promise<ReplaySnapshot | null> {
    if (drawCallIndex < 0 || drawCallIndex >= module.renderer_getCapturedFrameSize()) return null;
    module.renderer_replayToDrawCall(drawCallIndex);
    for (let i = 0; i < maxFrames && module.renderer_pollSnapshotReadback() === 0; i++) {
        await nextFrame();
    }
    const image = await getSnapshotImageData(module);
    return image ? { image, matchesCapture: module.renderer_snapshotMatchesCapture() } : null;
}
