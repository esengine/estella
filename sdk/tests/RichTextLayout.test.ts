import { describe, it, expect, beforeEach } from 'vitest';
import { layoutRichText, createFontSet, type LayoutLine } from '../src/ui/RichTextLayout';
import type { RichTextRun, ImageSegment } from '../src/ui/RichTextParser';
import type { Color } from '../src/types';

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };

function createMockCtx() {
    const charWidth = 8;
    let currentFont = '';
    return {
        font: '',
        set _font(v: string) { currentFont = v; },
        get _currentFont() { return currentFont; },
        measureText(text: string) {
            return { width: text.length * charWidth };
        },
    } as unknown as OffscreenCanvasRenderingContext2D;
}

function img(src: string, width: number, height: number): ImageSegment {
    return { type: 'image', src, width, height, valign: 'baseline', offsetX: 0, offsetY: 0, scale: 1, tint: null };
}

describe('layoutRichText – image runs', () => {
    let ctx: OffscreenCanvasRenderingContext2D;
    let fontSet: ReturnType<typeof createFontSet>;

    beforeEach(() => {
        ctx = createMockCtx();
        fontSet = createFontSet(16, 'sans-serif');
    });

    it('image run occupies its width in the line', () => {
        const runs: RichTextRun[] = [
            { type: 'text', text: 'A', bold: false, italic: false, color: null },
            img('icon', 24, 24),
            { type: 'text', text: 'B', bold: false, italic: false, color: null },
        ];
        const lines = layoutRichText(ctx, runs, fontSet, WHITE, 0);
        expect(lines).toHaveLength(1);

        const imgRun = lines[0].runs.find(r => r.type === 'image');
        expect(imgRun).toBeDefined();
        expect(imgRun!.width).toBe(24);

        const bRun = lines[0].runs.find(r => r.type === 'text' && r.text === 'B');
        expect(bRun).toBeDefined();
        expect(bRun!.x).toBeGreaterThanOrEqual(imgRun!.x + 24);
    });

    it('image wraps to next line when it does not fit', () => {
        // 'AB' = 16px, image = 200px, maxWidth = 50
        const runs: RichTextRun[] = [
            { type: 'text', text: 'AB', bold: false, italic: false, color: null },
            img('big', 200, 32),
        ];
        const lines = layoutRichText(ctx, runs, fontSet, WHITE, 50);
        expect(lines.length).toBeGreaterThanOrEqual(2);

        const lastLine = lines[lines.length - 1];
        const imgRun = lastLine.runs.find(r => r.type === 'image');
        expect(imgRun).toBeDefined();
    });

    it('line height is expanded when image is taller than text', () => {
        const runs: RichTextRun[] = [
            { type: 'text', text: 'Hi', bold: false, italic: false, color: null },
            img('tall', 16, 48),
        ];
        const lines = layoutRichText(ctx, runs, fontSet, WHITE, 0);
        expect(lines).toHaveLength(1);
        expect(lines[0].height).toBe(48);
    });

    it('line records max image height even when small', () => {
        const runs: RichTextRun[] = [
            { type: 'text', text: 'Hi', bold: false, italic: false, color: null },
            img('small', 8, 8),
        ];
        const lines = layoutRichText(ctx, runs, fontSet, WHITE, 0);
        expect(lines).toHaveLength(1);
        expect(lines[0].height).toBe(8);
    });

    it('image does not wrap when wordWrap is disabled (maxWidth=0)', () => {
        const runs: RichTextRun[] = [
            { type: 'text', text: 'X', bold: false, italic: false, color: null },
            img('wide', 9999, 16),
        ];
        const lines = layoutRichText(ctx, runs, fontSet, WHITE, 0);
        expect(lines).toHaveLength(1);
    });

    it('single image wider than container still gets placed', () => {
        const runs: RichTextRun[] = [img('huge', 500, 32)];
        const lines = layoutRichText(ctx, runs, fontSet, WHITE, 100);
        expect(lines).toHaveLength(1);
        const imgRun = lines[0].runs[0];
        expect(imgRun.type).toBe('image');
    });

    it('consecutive images layout with correct x offsets', () => {
        const runs: RichTextRun[] = [
            img('a', 20, 16),
            img('b', 30, 16),
            img('c', 10, 16),
        ];
        const lines = layoutRichText(ctx, runs, fontSet, WHITE, 0);
        expect(lines).toHaveLength(1);
        expect(lines[0].runs[0].x).toBe(0);
        expect(lines[0].runs[1].x).toBe(20);
        expect(lines[0].runs[2].x).toBe(50);
        expect(lines[0].width).toBe(60);
    });
});
