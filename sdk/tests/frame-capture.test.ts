/**
 * @file    frame-capture.test.ts
 * @brief   Pin down the memory-safety contract of frameCapture.ts: the
 *          returned data must be a JS-owned copy that survives subsequent
 *          mutation or reuse of the WASM-backed source buffer.
 */
import { describe, expect, it } from 'vitest';
import { decodeFrameCapture, getSnapshotImageData, RenderType, FlushReason } from '../src/frameCapture';
import type { ESEngineModule } from '../src/wasm';

// Minimal ImageData shim for headless test runs. Mirrors the parts of the
// DOM API that getSnapshotImageData uses.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === 'undefined') {
    class ImageDataShim {
        readonly data: Uint8ClampedArray;
        readonly width: number;
        readonly height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
            this.data = data;
            this.width = width;
            this.height = height;
        }
    }
    (globalThis as { ImageData: unknown }).ImageData = ImageDataShim;
}

/** Build a fake ESEngineModule exposing just the capture surface. */
function buildModule(opts: {
    width: number;
    height: number;
    drawCallCount?: number;
    entities?: number[];
}): { module: ESEngineModule; heap: Uint8Array; dataPtr: number; entitiesPtr: number; snapshotPtr: number } {
    const { width, height, drawCallCount = 0, entities = [] } = opts;
    const RECORD_SIZE = 76;
    const snapshotSize = width * height * 4;
    const entitiesSize = entities.length * 4;
    const drawCallsSize = drawCallCount * RECORD_SIZE;

    // Layout: [snapshot | entities | drawCalls]
    const totalSize = snapshotSize + entitiesSize + drawCallsSize + 16;
    const buffer = new ArrayBuffer(totalSize);
    const heap = new Uint8Array(buffer);

    const snapshotPtr = 0;
    const entitiesPtr = snapshotSize;
    const dataPtr = snapshotSize + entitiesSize;

    // Fill snapshot with a recognizable pattern: each pixel is (i % 256).
    for (let i = 0; i < snapshotSize; i++) {
        heap[snapshotPtr + i] = i & 0xFF;
    }

    // Fill entities
    const u32 = new Uint32Array(buffer);
    for (let i = 0; i < entities.length; i++) {
        u32[(entitiesPtr >> 2) + i] = entities[i];
    }

    // Fill draw-call records with placeholder values (all zeroes is fine;
    // the decode function just reads the structure).
    const module: ESEngineModule = {
        HEAPU8: heap,
        renderer_hasCapturedData: () => drawCallCount > 0,
        renderer_getCapturedFrameSize: () => drawCallCount,
        renderer_getCapturedFrameData: () => dataPtr,
        renderer_getCapturedEntities: () => entitiesPtr,
        renderer_getCapturedEntityCount: () => entities.length,
        renderer_getCapturedCameraCount: () => 1,
        renderer_getSnapshotSize: () => snapshotSize,
        renderer_getSnapshotWidth: () => width,
        renderer_getSnapshotHeight: () => height,
        renderer_getSnapshotPtr: () => snapshotPtr,
    } as unknown as ESEngineModule;

    return { module, heap, dataPtr, entitiesPtr, snapshotPtr };
}

describe('getSnapshotImageData', () => {
    it('returns a JS-owned buffer independent from the WASM heap', () => {
        const { module, heap, snapshotPtr } = buildModule({ width: 4, height: 2 });
        const img = getSnapshotImageData(module);
        expect(img).not.toBeNull();

        const snapshotBefore = Array.from(img!.data);

        // Aggressively scramble the heap region the snapshot came from. If
        // the returned data still aliased HEAPU8 we'd see the new bytes.
        for (let i = snapshotPtr; i < snapshotPtr + snapshotBefore.length; i++) heap[i] = 0xAB;

        const snapshotAfter = Array.from(img!.data);
        expect(snapshotAfter).toEqual(snapshotBefore);
    });

    it('returns null when the renderer has no snapshot available', () => {
        const zero = buildModule({ width: 0, height: 0 });
        expect(getSnapshotImageData(zero.module)).toBeNull();
    });

    it('applies vertical flip so row 0 of output is the last source row', () => {
        const w = 2, h = 3;
        const { module } = buildModule({ width: w, height: h });
        const img = getSnapshotImageData(module)!;
        expect(img.width).toBe(w);
        expect(img.height).toBe(h);

        // Source pattern: byte at (y*rowBytes + x) = (y*rowBytes + x) & 0xFF.
        // Flipped output: dst row 0 = src row (h-1). First byte of dst row 0
        // should equal (h-1)*w*4 & 0xFF.
        const rowBytes = w * 4;
        expect(img.data[0]).toBe(((h - 1) * rowBytes) & 0xFF);
    });
});

describe('decodeFrameCapture', () => {
    it('returns null when no data has been captured', () => {
        const { module } = buildModule({ width: 1, height: 1 });
        expect(decodeFrameCapture(module)).toBeNull();
    });

    it('copies entity indices as numbers, not as views over WASM memory', () => {
        const { module, heap, entitiesPtr, dataPtr } = buildModule({
            width: 1, height: 1, drawCallCount: 1, entities: [101, 202, 303],
        });

        // Populate draw-call record to reference the entity range.
        const u32 = new Uint32Array(heap.buffer);
        u32[(dataPtr >> 2) + 8] = 3;  // entityCount at offset 32
        u32[(dataPtr >> 2) + 9] = 0;  // entityOffset at offset 36

        const capture = decodeFrameCapture(module)!;
        expect(capture.drawCalls).toHaveLength(1);
        expect(capture.drawCalls[0].entities).toEqual([101, 202, 303]);

        // Scramble the entity region in WASM memory.
        u32[entitiesPtr >> 2] = 999;
        u32[(entitiesPtr >> 2) + 1] = 999;
        u32[(entitiesPtr >> 2) + 2] = 999;

        // Captured entities remain unchanged (primitive numbers were copied).
        expect(capture.drawCalls[0].entities).toEqual([101, 202, 303]);
    });

    it('surfaces enum values with the typed names (smoke)', () => {
        expect(RenderType.Sprite).toBe(0);
        expect(FlushReason.BatchFull).toBe(0);
    });
});
