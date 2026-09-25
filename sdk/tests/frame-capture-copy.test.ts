// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A native host hands its captured frame out by copying into a buffer in
 *        its heap, where the wasm module hands out addresses; the frame decoded
 *        either way is the same frame.
 */
import { describe, it, expect } from 'vitest';
import { decodeFrameCapture, getSnapshotImageData, type CaptureEngine } from '../src/render/frameCapture';

const RECORD = 84;

function engine(byAddress: boolean): CaptureEngine {
    const heap = new Uint8Array(4096);
    const recordsAt = 64, entitiesAt = 512, texturesAt = 768, pixelsAt = 1024;
    const view = new DataView(heap.buffer);
    for (let i = 0; i < 2; i++) {
        const o = recordsAt + i * RECORD;
        view.setUint32(o, i, true);
        view.setUint32(o + 4, 1, true);
        view.setUint32(o + 24, 6 * (i + 1), true);
        view.setUint32(o + 32, 1, true);
        view.setUint32(o + 36, i, true);
        view.setUint8(o + 44, 6);
        view.setUint8(o + 72, 1);
        view.setUint32(o + 80, i, true);
    }
    new Uint32Array(heap.buffer, entitiesAt, 2).set([4194305, 4194306]);
    new Uint32Array(heap.buffer, texturesAt, 2).set([7, 9]);
    heap.set([10, 20, 30, 255, 40, 50, 60, 255], pixelsAt);
    let next = 2048;
    const copier = (at: number, bytes: number) => (dest: number, size: number) => {
        if (size < bytes) return false;
        heap.copyWithin(dest, at, at + bytes);
        return true;
    };
    const base = {
        HEAPU8: heap,
        renderer_captureNextFrame: () => {},
        renderer_hasCapturedData: () => true,
        renderer_getCapturedFrameSize: () => 2,
        renderer_getCapturedEntityCount: () => 2,
        renderer_getCapturedTextureCount: () => 2,
        renderer_getCapturedPassCount: () => 1,
        renderer_replayToDrawCall: () => {},
        renderer_snapshotMatchesCapture: () => true,
        renderer_pollSnapshotReadback: () => 1,
        renderer_getSnapshotSize: () => 8,
        renderer_getSnapshotWidth: () => 1,
        renderer_getSnapshotHeight: () => 2,
    };
    return byAddress
        ? {
            ...base,
            renderer_getCapturedFrameData: () => recordsAt,
            renderer_getCapturedEntities: () => entitiesAt,
            renderer_getCapturedTextures: () => texturesAt,
            renderer_getSnapshotPtr: () => pixelsAt,
        }
        : {
            ...base,
            _malloc: (bytes: number) => { const at = next; next += bytes; return at; },
            _free: () => {},
            renderer_copyCapturedRecords: copier(recordsAt, 2 * RECORD),
            renderer_copyCapturedEntities: copier(entitiesAt, 8),
            renderer_copyCapturedTextures: copier(texturesAt, 8),
            renderer_copySnapshot: copier(pixelsAt, 8),
        };
}

describe('a captured frame', () => {
    it('decodes the same whether the engine gives addresses or copies', () => {
        const byAddress = decodeFrameCapture(engine(true));
        const byCopy = decodeFrameCapture(engine(false));
        expect(byCopy).toEqual(byAddress);
        expect(byCopy?.drawCalls.map((d) => [d.index, d.indexCount, d.entities, d.textures])).toEqual([
            [0, 6, [4194305], [7]],
            [1, 12, [4194306], [9]],
        ]);
    });

    it('replays to the same pixels either way', async () => {
        const a = await getSnapshotImageData(engine(true));
        const b = await getSnapshotImageData(engine(false));
        expect(Array.from(b!.data)).toEqual(Array.from(a!.data));
        expect(Array.from(b!.data)).toEqual([40, 50, 60, 255, 10, 20, 30, 255]);
    });

    it('is nothing, not garbage, on a host that can neither give addresses nor copy', () => {
        const e = engine(false);
        delete e.renderer_copyCapturedRecords;
        expect(decodeFrameCapture(e)).toBeNull();
    });
});
