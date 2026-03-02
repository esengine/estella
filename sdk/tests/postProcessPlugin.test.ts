import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/material', () => ({
    Material: {
        createShader: vi.fn().mockReturnValue(42),
        releaseShader: vi.fn(),
    },
}));

import { postProcessPlugin } from '../src/postprocess/PostProcessPlugin';

describe('PostProcessPlugin', () => {
    it('has correct name', () => {
        expect(postProcessPlugin.name).toBe('PostProcessPlugin');
    });

    it('implements Plugin interface with build and cleanup', () => {
        expect(typeof postProcessPlugin.build).toBe('function');
        expect(typeof postProcessPlugin.cleanup).toBe('function');
    });
});
