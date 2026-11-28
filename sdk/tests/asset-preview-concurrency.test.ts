// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawPreview, type PreviewCore } from '../src/render/assetPreview';
afterEach(() => vi.unstubAllGlobals());
const core = () => ({ HEAPU8: new Uint8Array(4), renderer_pollPreviewReadback: () => 1,
    renderer_getPreviewSize: () => 4, renderer_getPreviewWidth: () => 1,
    renderer_getPreviewHeight: () => 1, renderer_getPreviewPtr: () => 0 } as unknown as PreviewCore);
const imageData = () => vi.stubGlobal('ImageData', class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
});
describe('shared preview readback ownership', () => {
    it('copies each result before a concurrent request overwrites the core buffer', async () => {
        imageData(); const m = core();
        const images = await Promise.all([11, 22, 33].map(value => drawPreview(m, () => m.HEAPU8.fill(value))));
        expect(images.map(image => image!.data[0])).toEqual([11, 22, 33]);
    });
    it('does not poison subsequent requests after a draw throws', async () => {
        imageData(); const m = core();
        const bad = drawPreview(m, () => { throw Error('draw rejected'); });
        const next = drawPreview(m, () => m.HEAPU8.fill(44));
        await expect(bad).rejects.toThrow('draw rejected');
        expect((await next)!.data[0]).toBe(44);
    });
    it('allows another core to finish while the first core still owes a readback', async () => {
        imageData(); const first = core(), second = core(); let ready = false;
        first.renderer_pollPreviewReadback = () => ready ? 1 : 0;
        const pending = drawPreview(first, () => first.HEAPU8.fill(55));
        try {
            const image = await Promise.race([drawPreview(second, () => second.HEAPU8.fill(66)),
                new Promise<never>((_, reject) => setTimeout(() => reject(Error('independent core blocked')), 100))]);
            expect(image!.data[0]).toBe(66);
        } finally { ready = true; await pending; }
    });
    it('skips canceled submissions and pixel copies while draining the active readback', async () => {
        imageData();
        const m = core();
        const active = new AbortController(), queued = new AbortController();
        let ready = false;
        m.renderer_pollPreviewReadback = () => ready ? 1 : 0;
        const getPixels = vi.spyOn(m, 'renderer_getPreviewPtr');
        const submitActive = vi.fn(), submitQueued = vi.fn();
        const first = drawPreview(m, submitActive, active.signal);
        await Promise.resolve();
        expect(submitActive).toHaveBeenCalledOnce();
        const obsolete = drawPreview(m, submitQueued, queued.signal);
        active.abort(); queued.abort();
        const submitNext = vi.fn(() => m.HEAPU8.fill(77));
        const next = drawPreview(m, submitNext);
        await Promise.resolve();
        const overlap = submitNext.mock.calls.length;
        ready = true;
        expect(overlap).toBe(0);
        expect(await first).toBeNull();
        expect(await obsolete).toBeNull();
        expect(submitQueued).not.toHaveBeenCalled();
        expect((await next)!.data[0]).toBe(77);
        expect(getPixels).toHaveBeenCalledOnce();
    });
});
