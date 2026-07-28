// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateComponentData, formatValidationErrors } from '../src/util/validation';

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

    it('detects nested member type mismatches with dotted field paths', () => {
        const defaults = { size: { x: 0, y: 0 } };
        const data = { size: { x: 'garbage', y: 16 } };
        const errors = validateComponentData('Test', defaults, data);
        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('size.x');
        expect(errors[0].expected).toBe('number');
        expect(errors[0].actual).toBe('string');
    });

    it('recurses through deeper object nesting', () => {
        const defaults = { a: { b: { c: 0 } } };
        const data = { a: { b: { c: 'nope' } } };
        const errors = validateComponentData('Test', defaults, data);
        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('a.b.c');
    });

    it('tolerates unknown NESTED members (wasm colors keep ghost x/y/z/w beside r/g/b/a)', () => {
        const defaults = { color: { r: 1, g: 1, b: 1, a: 1 } };
        const data = { color: { r: 1, g: 0, b: 0, a: 1, x: 1, y: 0, z: 0, w: 1 } };
        expect(validateComponentData('Test', defaults, data)).toEqual([]);
    });

    it('still flags unknown TOP-LEVEL fields while tolerating nested ones', () => {
        const defaults = { size: { x: 0, y: 0 } };
        const data = { 'size.x': '16' };
        const errors = validateComponentData('Test', defaults, data);
        expect(errors).toHaveLength(1);
        expect(errors[0].field).toBe('size.x');
        expect(errors[0].actual).toBe('unknown field');
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
