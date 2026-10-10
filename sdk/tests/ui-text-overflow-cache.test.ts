// SPDX-License-Identifier: Apache-2.0
import { expect, it, vi } from 'vitest';
import { GlyphAtlas } from '../src/ui/text/glyph-atlas';
import { SdfTextRenderer, drawTextWith, type DrawTextParams } from '../src/ui/text/text-renderer';
import { TextOverflow } from '../src/ui/core/text';
import { submitTextBatch } from '../src/ui/text/submit';
vi.mock('../src/ui/text/submit', async importOriginal => ({
    ...await importOriginal<typeof import('../src/ui/text/submit')>(), submitTextBatch: vi.fn(),
}));

it('rebuilds only changed overflow geometry while other static text keeps its cached batches', () => {
    const atlas = new GlyphAtlas({ renderSize: 48, spread: 0, rasterize: () => ({
        pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12,
        advance: 11, bearingX: 1, bearingY: 10,
    }) }, { createPage: () => 1000, uploadSubRegion: () => {} }, { pageSize: 1024, padding: 1, sdf: false });
    // Inject an atlas and submission sink, preserving the real renderer cache path.
    const renderer = Object.assign(Object.create(SdfTextRenderer.prototype), {
        atlas, sdf: false, module: null, cache_: new Map(),
    }) as SdfTextRenderer;
    const transform = new Float32Array(16);
    const params: DrawTextParams = { text: 'ABCDEF', fontFamily: 'Arial', fontSizePx: 48,
        color: [1, 1, 1, 1], boxWidth: 24, boxHeight: 60, overflow: TextOverflow.Visible };
    const submit = vi.mocked(submitTextBatch);
    const draw = (entity: number, p = params) => {
        submit.mockClear(); renderer.drawText(p, transform, entity, 0, 0);
        return submit.mock.calls.map(call => call[1]);
    };
    const initial = draw(1), other = draw(2);
    const reads = vi.spyOn(atlas, 'getGlyph');
    expect(draw(1)[0]).toBe(initial[0]);
    expect(reads).not.toHaveBeenCalled();
    for (const overflow of [TextOverflow.Clip, TextOverflow.Ellipsis, TextOverflow.Visible]) {
        const next = { ...params, overflow };
        const batches = draw(1, next);
        const expected: Float32Array[] = [];
        drawTextWith(atlas, vertices => expected.push(vertices), next);
        expect(batches.map(vertices => Array.from(vertices))).toEqual(expected.map(vertices => Array.from(vertices)));
        reads.mockClear();
        expect(draw(2)[0]).toBe(other[0]);
        expect(reads).not.toHaveBeenCalled();
    }
});

it('invalidates cached geometry when text and font names contain field delimiters', () => {
    const atlas = new GlyphAtlas({ renderSize: 48, spread: 0, rasterize: () => ({
        pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12,
        advance: 11, bearingX: 1, bearingY: 10,
    }) }, { createPage: () => 1000, uploadSubRegion: () => {} }, { pageSize: 1024, padding: 1, sdf: false });
    const renderer = Object.assign(Object.create(SdfTextRenderer.prototype), {
        atlas, sdf: false, module: null, cache_: new Map(),
    }) as SdfTextRenderer;
    const transform = new Float32Array(16);
    const submit = vi.mocked(submitTextBatch);
    const first: DrawTextParams = { text: 'A|B', fontFamily: 'Arial', fontSizePx: 48, color: [1, 1, 1, 1] };
    renderer.drawText(first, transform, 1, 0, 0);
    const next = { ...first, text: 'A', fontFamily: 'B|Arial' };
    submit.mockClear();
    renderer.drawText(next, transform, 1, 0, 0);
    const expected: Float32Array[] = [];
    drawTextWith(atlas, vertices => expected.push(vertices), next);
    expect(submit.mock.calls.map(call => Array.from(call[1])))
        .toEqual(expected.map(vertices => Array.from(vertices)));
    const updated = submit.mock.calls[0][1];
    submit.mockClear();
    const reads = vi.spyOn(atlas, 'getGlyph');
    renderer.drawText(next, transform, 1, 0, 0);
    expect(submit.mock.calls[0][1]).toBe(updated);
    expect(reads).not.toHaveBeenCalled();
});
