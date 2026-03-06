import type { ESEngineModule } from './wasm';

export enum FlushReason {
    BatchFull = 0,
    TextureSlotsFull = 1,
    ScissorChange = 2,
    StencilChange = 3,
    MaterialChange = 4,
    BlendModeChange = 5,
    StageEnd = 6,
    TypeChange = 7,
    FrameEnd = 8,
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

export interface DrawCallInfo {
    index: number;
    cameraIndex: number;
    stage: number;
    type: RenderType;
    blendMode: number;
    textureId: number;
    materialId: number;
    shaderId: number;
    vertexCount: number;
    triangleCount: number;
    entityCount: number;
    entityOffset: number;
    layer: number;
    flushReason: FlushReason;
    scissorX: number;
    scissorY: number;
    scissorW: number;
    scissorH: number;
    scissorEnabled: boolean;
    stencilWrite: boolean;
    stencilTest: boolean;
    stencilRef: number;
    textureSlotUsage: number;
    entities: number[];
}

export interface FrameCaptureData {
    drawCalls: DrawCallInfo[];
    cameraCount: number;
}

const RECORD_SIZE_BYTES = 76;

export function decodeFrameCapture(module: ESEngineModule): FrameCaptureData | null {
    if (!module.renderer_hasCapturedData()) return null;

    const count = module.renderer_getCapturedFrameSize();
    if (count === 0) return null;

    const dataPtr = module.renderer_getCapturedFrameData();
    const entitiesPtr = module.renderer_getCapturedEntities();
    const entityCount = module.renderer_getCapturedEntityCount();
    const cameraCount = module.renderer_getCapturedCameraCount();

    const heap = module.HEAPU8;
    const view = new DataView(heap.buffer, dataPtr, count * RECORD_SIZE_BYTES);

    const entityHeap = new Uint32Array(heap.buffer, entitiesPtr, entityCount);

    const drawCalls: DrawCallInfo[] = [];
    for (let i = 0; i < count; i++) {
        const off = i * RECORD_SIZE_BYTES;
        const index = view.getUint32(off, true);
        const cameraIndex = view.getUint32(off + 4, true);
        const stage = view.getUint8(off + 8);
        const type = view.getUint8(off + 9) as RenderType;
        const blendMode = view.getUint8(off + 10);
        const textureId = view.getUint32(off + 12, true);
        const materialId = view.getUint32(off + 16, true);
        const shaderId = view.getUint32(off + 20, true);
        const vertexCount = view.getUint32(off + 24, true);
        const triangleCount = view.getUint32(off + 28, true);
        const dcEntityCount = view.getUint32(off + 32, true);
        const entityOffset = view.getUint32(off + 36, true);
        const layer = view.getInt32(off + 40, true);
        const flushReason = view.getUint8(off + 44) as FlushReason;
        const scissorX = view.getInt32(off + 48, true);
        const scissorY = view.getInt32(off + 52, true);
        const scissorW = view.getInt32(off + 56, true);
        const scissorH = view.getInt32(off + 60, true);
        const scissorEnabled = view.getUint8(off + 64) !== 0;
        const stencilWrite = view.getUint8(off + 65) !== 0;
        const stencilTest = view.getUint8(off + 66) !== 0;
        const stencilRef = view.getInt32(off + 68, true);
        const textureSlotUsage = view.getUint8(off + 72);

        const entities: number[] = [];
        for (let e = 0; e < dcEntityCount && entityOffset + e < entityCount; e++) {
            entities.push(entityHeap[entityOffset + e]);
        }

        drawCalls.push({
            index, cameraIndex, stage, type, blendMode,
            textureId, materialId, shaderId,
            vertexCount, triangleCount,
            entityCount: dcEntityCount, entityOffset, layer,
            flushReason,
            scissorX, scissorY, scissorW, scissorH, scissorEnabled,
            stencilWrite, stencilTest, stencilRef,
            textureSlotUsage, entities,
        });
    }

    return { drawCalls, cameraCount };
}

export function replayToDrawCall(module: ESEngineModule, drawCallIndex: number): void {
    module.renderer_replayToDrawCall(drawCallIndex);
}

export function getSnapshotImageData(module: ESEngineModule): ImageData | null {
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
