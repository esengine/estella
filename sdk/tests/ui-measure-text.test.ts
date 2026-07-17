// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { measureText } from '../src/ui';

// These hold whether measureText runs on real Canvas2D or the headless average
// fallback — they assert structure (line counts, height = lines × lineHeight),
// not exact pixel widths.
describe('measureText', () => {
    it('an unwrapped single line has lineCount 1 and height = fontSize × 1.2', () => {
        const m = measureText('hello world', { fontSize: 16 });
        expect(m.lineCount).toBe(1);
        expect(m.height).toBeCloseTo(16 * 1.2);
        expect(m.width).toBeGreaterThan(0);
    });

    it('counts explicit newlines as separate lines', () => {
        expect(measureText('a\nb\nc', { fontSize: 10 }).lineCount).toBe(3);
    });

    it('wraps long text past maxWidth into multiple lines; height tracks the count', () => {
        const long = 'word '.repeat(40).trim();
        const m = measureText(long, { fontSize: 16, maxWidth: 100 });
        expect(m.lineCount).toBeGreaterThan(1);
        expect(m.height).toBeCloseTo(m.lineCount * 16 * 1.2);
    });

    it('a custom lineHeight overrides the default ratio', () => {
        expect(measureText('x', { fontSize: 10, lineHeight: 30 }).height).toBe(30);
    });

    it('empty text is one (empty) line', () => {
        expect(measureText('', { fontSize: 12 }).lineCount).toBe(1);
    });
});
