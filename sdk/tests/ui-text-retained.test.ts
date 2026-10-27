// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A label's glyph quads are handed to the engine once and submitted by it every frame, so what decides "the label is the same" has to be right in
 * both directions: a field that changes the layout and is missing from the comparison leaves the old text on screen, and one that does not change
 * it and is in the comparison relays the label out for nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { GlyphAtlas } from '../src/ui/text/glyph-atlas';
import { SdfTextRenderer, drawTextWith, type DrawTextParams } from '../src/ui/text/text-renderer';
import { resolveTextRenderMode, sameSnapshot, snapshotOf } from '../src/ui/text/plugin';
import type { TextData } from '../src/ui/core/text';
import type { EngineApi } from '../src/ecs/bridge/engineApi';
import { TEXT_VERTEX_FLOATS } from '../src/ui/text/submit';

vi.mock('../src/platform', () => ({
    platformHasGlyphRasterizer: () => false,
    platformCreateCanvas: (width: number, height: number) => ({ width, height, getContext: () => null }),
}));

function freshText(): TextData {
    return {
        content: 'hello', i18nKey: '', font: 0, fontFamily: 'Arial', fontSize: 24, color: { r: 1, g: 1, b: 1, a: 1 },
        align: 0, verticalAlign: 0, wordWrap: true, overflow: 0, lineHeight: 1.2, bold: false, italic: false,
        strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidth: 0, shadowColor: { r: 0, g: 0, b: 0, a: 1 }, shadowBlur: 0,
        shadowOffsetX: 0, shadowOffsetY: 0, richText: false, renderMode: 0, layer: 0, enabled: true,
    } as TextData;
}

describe('which Text fields make a retained label laid out again', () => {
    // Every field of the component is either compared or has a stated reason it is not. A field added to Text lands here as a failure until
    // someone decides which.
    const compared: Array<[string, (t: TextData) => void]> = [
        ['content', t => { t.content = 'world'; }],
        ['fontFamily', t => { t.fontFamily = 'Courier'; }],
        ['fontSize', t => { t.fontSize = 30; }],
        ['color', t => { t.color = { r: 0.5, g: 1, b: 1, a: 1 }; }],
        ['align', t => { t.align = 1; }],
        ['verticalAlign', t => { t.verticalAlign = 1; }],
        ['wordWrap', t => { t.wordWrap = false; }],
        ['overflow', t => { t.overflow = 1; }],
        ['lineHeight', t => { t.lineHeight = 1.5; }],
        ['bold', t => { t.bold = true; }],
        ['italic', t => { t.italic = true; }],
        ['strokeColor', t => { t.strokeColor = { r: 1, g: 0, b: 0, a: 1 }; }],
        ['strokeWidth', t => { t.strokeWidth = 2; }],
        ['shadowColor', t => { t.shadowColor = { r: 0, g: 1, b: 0, a: 1 }; }],
        ['shadowBlur', t => { t.shadowBlur = 3; }],
        ['shadowOffsetX', t => { t.shadowOffsetX = 2; }],
        ['shadowOffsetY', t => { t.shadowOffsetY = 2; }],
        ['richText', t => { t.richText = true; }],
        ['renderMode', t => { t.renderMode = 1; }],
        ['layer', t => { t.layer = 3; }],
    ];
    // font is resolved to the family and compared as that; enabled and an empty content decide whether the label exists at all; i18nKey only
    // ever changes `content`.
    const elsewhere = ['font', 'enabled', 'i18nKey'];

    it('accounts for every field of the component', () => {
        const all = Object.keys(freshText()).sort();
        expect([...compared.map(([k]) => k), ...elsewhere].sort()).toEqual(all);
    });

    it.each(compared)('%s changes the comparison', (_key, change) => {
        const t = freshText();
        const snap = snapshotOf(t, 'Arial');
        expect(sameSnapshot(snap, t, 'Arial')).toBe(true);
        const changed = freshText();
        change(changed);
        expect(sameSnapshot(snap, changed, changed.fontFamily)).toBe(false);
    });

    it('treats the resolved family as the font', () => {
        const t = freshText();
        expect(sameSnapshot(snapshotOf(t, 'Arial'), t, 'Georgia')).toBe(false);
    });
});

describe('the glyph pipeline an automatic label gets', () => {
    // The engine decides it from the world scale (RetainedText.hpp, retainedTextAutoIsSdf) and this table is pinned there too: float32 values,
    // as the engine holds them.
    const table: Array<[number, 'bitmap' | 'sdf']> = [[1.0, 'bitmap'], [1.02, 'bitmap'], [0.98, 'bitmap'], [1.021, 'sdf'], [0.97, 'sdf'], [2.0, 'sdf'], [0.5, 'sdf'], [0.0, 'bitmap'], [-1.0, 'bitmap'], [Infinity, 'bitmap'], [NaN, 'bitmap']];
    it.each(table)('scale %s draws with %s', (scale, kind) => {
        expect(resolveTextRenderMode(undefined, Math.fround(scale))).toBe(kind);
    });
});

describe('handing a label to the engine', () => {
    function engine() {
        const heap = new Uint8Array(1 << 20);
        let top = 8;
        const batches: Array<{ entity: number; vertices: number[]; indices: number[]; vertexCount: number; pageId: number }> = [];
        const calls: string[] = [];
        const api = {
            HEAPU8: heap,
            _malloc: (n: number) => { const p = top; top += (n + 7) & ~7; return p; },
            _free: () => {},
            renderer_retainedTextBegin: (...a: number[]) => { calls.push(`begin ${a.join(',')}`); },
            renderer_retainedTextBatch: (entity: number, vPtr: number, vertexCount: number, iPtr: number, indexCount: number, pageId: number) => {
                calls.push(`batch ${entity} ${vertexCount} ${indexCount} ${pageId}`);
                batches.push({
                    entity, vertexCount, pageId,
                    vertices: Array.from(new Float32Array(heap.buffer.slice(vPtr, vPtr + vertexCount * TEXT_VERTEX_FLOATS * 4))),
                    indices: Array.from(new Uint16Array(heap.buffer.slice(iPtr, iPtr + indexCount * 2))),
                });
            },
        } as unknown as EngineApi;
        return { api, batches, calls };
    }

    function rendererWith(atlas: GlyphAtlas): SdfTextRenderer {
        const renderer = new SdfTextRenderer(null, { sdf: false, metricsOnly: true });
        Object.defineProperty(renderer, 'atlas', { value: atlas });
        return renderer;
    }

    const makeAtlas = () => {
        let page = 500;
        return new GlyphAtlas({ renderSize: 48, spread: 0, rasterize: () => ({
            pixels: new Uint8Array(10 * 12 * 4), width: 10, height: 12, advance: 11, bearingX: 1, bearingY: 10,
        }) }, { createPage: () => page++, uploadSubRegion: () => {} }, { pageSize: 1024, padding: 1, sdf: false });
    };

    const params: DrawTextParams = { text: 'ABC', fontFamily: 'Arial', fontSizePx: 24, color: [1, 1, 1, 1] };

    it('begins the label once and sends the quads the layout makes, whole', () => {
        const atlas = makeAtlas();
        const renderer = rendererWith(atlas);
        const { api, batches, calls } = engine();
        renderer.retain(api, params, 42, true, true, 7, 120, 30, true);
        expect(calls[0]).toBe('begin 42,0,1,1,7,120,30,1');
        const expected: Array<{ v: number[]; i: number[]; page: number }> = [];
        drawTextWith(atlas, (v, i, page) => expected.push({ v: Array.from(v), i: Array.from(i), page }), { ...params, opacity: 1 });
        expect(batches.map(b => ({ v: b.vertices, i: b.indices, page: b.pageId }))).toEqual(expected);
        expect(batches.every(b => b.entity === 42)).toBe(true);
    });

    it('keeps the atlas pages of a label that is not rebuilt, and lets them go when it is forgotten', () => {
        const atlas = makeAtlas();
        const renderer = rendererWith(atlas);
        const retain = vi.spyOn(atlas, 'retainPages');
        const { api, batches } = engine();
        renderer.retain(api, params, 5, false, false, 0, 0, 0, false);
        const pages = new Set(batches.map(b => b.pageId));
        expect(pages.size).toBeGreaterThan(0);
        // Frames that do not draw it again (an Update with no render, a frame the label is unchanged) must not release its pages.
        renderer.beginFrame();
        renderer.beginFrame();
        const kept = (retain.mock.calls.at(-1)![0] as Set<number>);
        expect([...pages].every(p => kept.has(p))).toBe(true);
        renderer.forget(5);
        renderer.beginFrame();
        const afterForget = (retain.mock.calls.at(-1)![0] as Set<number>);
        expect([...pages].some(p => afterForget.has(p))).toBe(false);
    });
});
