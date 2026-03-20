import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateComponentData, formatValidationErrors } from '../src/validation';

describe('validateComponentData', () => {
    it('should return no errors for valid data', () => {
        const defaults = { x: 0, y: 0, name: '' };
        const data = { x: 10, y: 20, name: 'test' };
        expect(validateComponentData('Test', defaults, data)).toEqual([]);
    });

    it('should detect unknown fields', () => {
        const defaults = { x: 0 };
        const data = { x: 1, typo: 'bad' };
        const errors = validateComponentData('Test', defaults, data);
        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('typo');
    });

    it('should detect type mismatches', () => {
        const defaults = { x: 0, name: '' };
        const data = { x: 'not a number', name: 42 };
        const errors = validateComponentData('Test', defaults, data);
        expect(errors).toHaveLength(2);
        expect(errors[0].field).toBe('x');
        expect(errors[0].expected).toBe('number');
        expect(errors[0].actual).toBe('string');
    });

    it('should allow null/undefined values', () => {
        const defaults = { texture: 0, label: '' };
        const data = { texture: null, label: undefined };
        expect(validateComponentData('Test', defaults, data)).toEqual([]);
    });

    it('should skip underscore-prefixed fields', () => {
        const defaults = { x: 0 };
        const data = { x: 1, _internal: true };
        expect(validateComponentData('Test', defaults, data)).toEqual([]);
    });

    it('should detect object vs primitive mismatch', () => {
        const defaults = { position: { x: 0, y: 0 } };
        const data = { position: 'invalid' };
        const errors = validateComponentData('Test', defaults, data);
        expect(errors).toHaveLength(1);
        expect(errors[0].expected).toBe('object');
        expect(errors[0].actual).toBe('string');
    });
});

describe('formatValidationErrors', () => {
    it('should format errors readably', () => {
        const errors = [
            { field: 'x', expected: 'number', actual: 'string', value: 'bad' },
        ];
        const msg = formatValidationErrors('Transform', errors);
        expect(msg).toContain('Transform');
        expect(msg).toContain('x');
        expect(msg).toContain('number');
        expect(msg).toContain('string');
    });
});
