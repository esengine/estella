import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Filters } from '../src/filters';

vi.mock('../src/material', () => ({
    Material: {
        createShader: vi.fn(() => 42),
    },
}));

vi.mock('../src/resourceManager', () => ({
    requireResourceManager: () => ({
        createMaterial: vi.fn(() => 100),
    }),
}));

describe('Filters', () => {
    describe('colorMatrix', () => {
        it('grayscale should return a 20-element matrix', () => {
            const matrix = Filters.grayscaleMatrix();
            expect(matrix).toHaveLength(20);
            expect(matrix[0]).toBeCloseTo(0.299, 2);
            expect(matrix[1]).toBeCloseTo(0.587, 2);
            expect(matrix[2]).toBeCloseTo(0.114, 2);
        });

        it('brightness should scale RGB channels', () => {
            const matrix = Filters.brightnessMatrix(1.5);
            expect(matrix[0]).toBe(1.5);
            expect(matrix[6]).toBe(1.5);
            expect(matrix[12]).toBe(1.5);
        });

        it('identity matrix should not change colors', () => {
            const matrix = Filters.identityMatrix();
            expect(matrix[0]).toBe(1);
            expect(matrix[6]).toBe(1);
            expect(matrix[12]).toBe(1);
            expect(matrix[18]).toBe(1);
        });

        it('sepia matrix should have warm tone values', () => {
            const matrix = Filters.sepiaMatrix();
            expect(matrix).toHaveLength(20);
            expect(matrix[0]).toBeCloseTo(0.393, 2);
        });
    });

    describe('contrast', () => {
        it('should scale around 0.5', () => {
            const matrix = Filters.contrastMatrix(2);
            expect(matrix).toHaveLength(20);
            expect(matrix[0]).toBe(2);
            expect(matrix[4]).toBeCloseTo(-0.5, 1);
        });
    });
});
