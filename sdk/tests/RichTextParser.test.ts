import { describe, it, expect } from 'vitest';
import { parseRichText, type RichTextRun } from '../src/ui/RichTextParser';

const IMG_DEFAULTS = { offsetX: 0, offsetY: 0, scale: 1, tint: null };

describe('parseRichText – <img> tag', () => {
    it('parses basic <img> with all attributes', () => {
        const runs = parseRichText('<img src="heart" width=24 height=32/>');
        expect(runs).toEqual([
            { type: 'image', src: 'heart', width: 24, height: 32, valign: 'baseline', ...IMG_DEFAULTS },
        ]);
    });

    it('parses <img> with quoted attribute values', () => {
        const runs = parseRichText('<img src="coin" width="16" height="16"/>');
        expect(runs).toEqual([
            { type: 'image', src: 'coin', width: 16, height: 16, valign: 'baseline', ...IMG_DEFAULTS },
        ]);
    });

    it('defaults width/height to 0 when omitted', () => {
        const runs = parseRichText('<img src="star"/>');
        expect(runs).toEqual([
            { type: 'image', src: 'star', width: 0, height: 0, valign: 'baseline', ...IMG_DEFAULTS },
        ]);
    });

    it('parses valign attribute', () => {
        const runs = parseRichText('<img src="icon" width=20 height=20 valign=middle/>');
        expect(runs).toEqual([
            { type: 'image', src: 'icon', width: 20, height: 20, valign: 'middle', ...IMG_DEFAULTS },
        ]);
    });

    it('parses offsetX, offsetY, scale attributes', () => {
        const runs = parseRichText('<img src="star" width=16 height=16 offsetX=2 offsetY=-3 scale=1.5/>');
        expect(runs).toHaveLength(1);
        const img = runs[0];
        expect(img).toMatchObject({ type: 'image', src: 'star', offsetX: 2, offsetY: -3, scale: 1.5 });
    });

    it('parses tint attribute as hex color', () => {
        const runs = parseRichText('<img src="heart" width=16 height=16 tint=#FF000080/>');
        expect(runs).toHaveLength(1);
        const img = runs[0] as any;
        expect(img.tint).toEqual({ r: 1, g: 0, b: 0, a: expect.closeTo(0.502, 1) });
    });

    it('defaults scale=1, offset=0, tint=null when omitted', () => {
        const runs = parseRichText('<img src="x" width=10 height=10/>');
        const img = runs[0] as any;
        expect(img.scale).toBe(1);
        expect(img.offsetX).toBe(0);
        expect(img.offsetY).toBe(0);
        expect(img.tint).toBeNull();
    });

    it('ignores surrounding text styles on <img>', () => {
        const runs = parseRichText('<b>HP<img src="heart" width=16 height=16/>100</b>');
        expect(runs).toHaveLength(3);
        expect(runs[0]).toEqual({ type: 'text', text: 'HP', bold: true, italic: false, color: null });
        expect(runs[1]).toMatchObject({ type: 'image', src: 'heart', width: 16, height: 16, valign: 'baseline' });
        expect(runs[2]).toEqual({ type: 'text', text: '100', bold: true, italic: false, color: null });
    });

    it('handles consecutive <img> tags', () => {
        const runs = parseRichText('<img src="a" width=10 height=10/><img src="b" width=20 height=20/>');
        expect(runs).toHaveLength(2);
        expect(runs[0]).toMatchObject({ type: 'image', src: 'a' });
        expect(runs[1]).toMatchObject({ type: 'image', src: 'b' });
    });

    it('handles mixed text and images', () => {
        const runs = parseRichText('Score: <img src="coin" width=16 height=16/>999');
        expect(runs).toHaveLength(3);
        expect(runs[0]).toEqual({ type: 'text', text: 'Score: ', bold: false, italic: false, color: null });
        expect(runs[1]).toMatchObject({ type: 'image', src: 'coin' });
        expect(runs[2]).toEqual({ type: 'text', text: '999', bold: false, italic: false, color: null });
    });

    it('treats <img> without src as literal text', () => {
        const runs = parseRichText('<img width=10 height=10/>');
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ type: 'text' });
    });

    it('existing text runs have type "text"', () => {
        const runs = parseRichText('<b>bold</b> normal');
        for (const run of runs) {
            expect(run.type).toBe('text');
        }
    });

    it('handles <img> inside <color>', () => {
        const runs = parseRichText('<color=#FF0000>red<img src="x" width=8 height=8/>text</color>');
        expect(runs).toHaveLength(3);
        expect(runs[0]).toMatchObject({ type: 'text', text: 'red', color: { r: 1, g: 0, b: 0, a: 1 } });
        expect(runs[1]).toMatchObject({ type: 'image', src: 'x' });
        expect(runs[2]).toMatchObject({ type: 'text', text: 'text', color: { r: 1, g: 0, b: 0, a: 1 } });
    });
});
