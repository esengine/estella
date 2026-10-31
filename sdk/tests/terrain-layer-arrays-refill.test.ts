// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A ground's layer arrays are not kept by the device: after a loss they are packed again, once for every kind, and moved behind the
 *        handles they had.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app/app';
import { TextureContent, type CppResourceManager } from '../src/wasm';
import { initResourceManager, shutdownResourceManager, textureRefill } from '../src/wasm/resourceManager';
import { createLayerArrays, releaseLayerArrays } from '../src/terrain/layerArrays';
import type { PackedLayers } from '../src/terrain/layers';

const layer = (): Uint8Array => new Uint8Array(2 * 2 * 4);
const packed = (): PackedLayers => ({ size: 2, albedo: [layer()], normal: [layer()], mask: [layer()], tiles: [4], heightBlends: [-1] });

function engine() {
    let next = 10;
    const content = new Map<number, number>();
    const rm = {
        createTextureArrayFromBytes: vi.fn((_w: number, _h: number, _n: number, _bytes: Uint8Array, _f: number, _fi: number, _wr: number, c: number) => {
            const handle = next++;
            content.set(handle, c);
            return handle;
        }),
        adoptTextureContent: vi.fn((_into: number, _from: number) => true),
        releaseTexture: vi.fn(),
    };
    initResourceManager(rm as unknown as CppResourceManager);
    return { rm, content, app: { wasmModule: null } as unknown as App };
}

afterEach(() => shutdownResourceManager());

describe('terrain layer arrays after a device loss', () => {
    it('are made as content their creator composes, not bytes the device keeps', () => {
        const { content, app } = engine();
        const handles = createLayerArrays(app, packed(), ['albedo', 'normal', 'mask'], async () => packed())!;
        expect(handles.map((h) => content.get(h))).toEqual([TextureContent.Composed, TextureContent.Composed, TextureContent.Composed]);
    });

    it('are packed again once for all three and moved behind the handles they had, at every loss', async () => {
        const { rm, content, app } = engine();
        const repack = vi.fn(async () => packed());
        const handles = createLayerArrays(app, packed(), ['albedo', 'normal', 'mask'], repack)!;

        for (const loss of [1, 2]) {
            rm.adoptTextureContent.mockClear();
            for (const h of handles) expect(await textureRefill(h)!()).toBe(true);
            expect(repack).toHaveBeenCalledTimes(loss);
            expect(rm.adoptTextureContent.mock.calls.map(([into]) => into)).toEqual(handles);
            for (const [, fresh] of rm.adoptTextureContent.mock.calls) {
                expect(content.get(fresh)).toBe(TextureContent.Transient);
                expect(rm.releaseTexture).toHaveBeenCalledWith(fresh);
            }
        }
    });

    it('take their refills with them when released', () => {
        const { app } = engine();
        const handles = createLayerArrays(app, packed(), ['albedo', 'normal'], async () => packed())!;
        releaseLayerArrays(handles);
        expect(handles.map((h) => textureRefill(h))).toEqual([undefined, undefined]);
    });
});
