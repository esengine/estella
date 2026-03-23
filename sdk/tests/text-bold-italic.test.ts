import { describe, it, expect } from 'vitest';
import { Text, type TextData } from '../src/ui/text';

describe('Text bold/italic', () => {
    it('defaults to false', () => {
        const defaults = Text._default as TextData;
        expect(defaults.bold).toBe(false);
        expect(defaults.italic).toBe(false);
    });

    it('bold and italic fields exist in component data', () => {
        const data: TextData = {
            ...(Text._default as TextData),
            bold: true,
            italic: true,
        };
        expect(data.bold).toBe(true);
        expect(data.italic).toBe(true);
    });
});
