vi.mock('../src/material', () => ({
    Material: {
        createShader: vi.fn().mockReturnValue(42),
    },
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostProcess, initPostProcessAPI, shutdownPostProcessAPI } from '../src/postprocess';
import { Material } from '../src/material';
import type { ESEngineModule } from '../src/wasm';

// =============================================================================
// Mock WASM module for PostProcess API
// =============================================================================

function createPostProcessMockModule() {
    const mock = {
        postprocess_init: vi.fn().mockReturnValue(true),
        postprocess_shutdown: vi.fn(),
        postprocess_resize: vi.fn(),
        postprocess_addPass: vi.fn().mockReturnValue(0),
        postprocess_removePass: vi.fn(),
        postprocess_setPassEnabled: vi.fn(),
        postprocess_isPassEnabled: vi.fn().mockReturnValue(true),
        postprocess_setUniformFloat: vi.fn(),
        postprocess_setUniformVec4: vi.fn(),
        postprocess_begin: vi.fn(),
        postprocess_end: vi.fn(),
        postprocess_getPassCount: vi.fn().mockReturnValue(3),
        postprocess_isInitialized: vi.fn().mockReturnValue(true),
        postprocess_setBypass: vi.fn(),
        postprocess_isBypassed: vi.fn().mockReturnValue(false),
    };

    return mock;
}

type MockModule = ReturnType<typeof createPostProcessMockModule>;

// =============================================================================
// Tests
// =============================================================================

describe('PostProcess API', () => {
    let mock: MockModule;

    beforeEach(() => {
        mock = createPostProcessMockModule();
        initPostProcessAPI(mock as unknown as ESEngineModule);
        vi.clearAllMocks();
    });

    afterEach(() => {
        shutdownPostProcessAPI();
    });

    // =========================================================================
    // initPostProcessAPI / shutdownPostProcessAPI
    // =========================================================================

    describe('initPostProcessAPI', () => {
        it('should set the module without throwing', () => {
            expect(() => initPostProcessAPI(mock as unknown as ESEngineModule)).not.toThrow();
        });
    });

    describe('shutdownPostProcessAPI', () => {
        it('should call postprocess_shutdown when initialized', () => {
            mock.postprocess_isInitialized.mockReturnValue(true);
            shutdownPostProcessAPI();
            expect(mock.postprocess_shutdown).toHaveBeenCalledOnce();
        });

        it('should not call postprocess_shutdown when not initialized', () => {
            mock.postprocess_isInitialized.mockReturnValue(false);
            shutdownPostProcessAPI();
            expect(mock.postprocess_shutdown).not.toHaveBeenCalled();
        });

        it('should handle double shutdown gracefully', () => {
            mock.postprocess_isInitialized.mockReturnValue(true);
            shutdownPostProcessAPI();
            shutdownPostProcessAPI();
            expect(mock.postprocess_shutdown).toHaveBeenCalledOnce();
        });
    });

    // =========================================================================
    // Uninitialized guard
    // =========================================================================

    describe('uninitialized guard', () => {
        it('should return false for isInitialized after shutdown', () => {
            shutdownPostProcessAPI();
            expect(PostProcess.isInitialized()).toBe(false);
        });

        it('should return true for isBypassed after shutdown', () => {
            shutdownPostProcessAPI();
            expect(PostProcess.isBypassed()).toBe(true);
        });

        it('should return false from init after shutdown', () => {
            shutdownPostProcessAPI();
            expect(PostProcess.init(800, 600)).toBe(false);
        });

        it('should return -1 from addPass after shutdown', () => {
            shutdownPostProcessAPI();
            expect(PostProcess.addPass('test', 1)).toBe(-1);
        });

        it('should not throw from begin after shutdown', () => {
            shutdownPostProcessAPI();
            expect(() => PostProcess.begin()).not.toThrow();
        });
    });

    // =========================================================================
    // Pipeline lifecycle
    // =========================================================================

    describe('pipeline lifecycle', () => {
        it('should call postprocess_init with width and height', () => {
            PostProcess.init(1920, 1080);
            expect(mock.postprocess_init).toHaveBeenCalledWith(1920, 1080);
        });

        it('should return the WASM result from init', () => {
            mock.postprocess_init.mockReturnValue(true);
            expect(PostProcess.init(800, 600)).toBe(true);

            mock.postprocess_init.mockReturnValue(false);
            expect(PostProcess.init(800, 600)).toBe(false);
        });

        it('should call postprocess_shutdown', () => {
            PostProcess.shutdown();
            expect(mock.postprocess_shutdown).toHaveBeenCalledOnce();
        });

        it('should call postprocess_resize with width and height', () => {
            PostProcess.resize(1280, 720);
            expect(mock.postprocess_resize).toHaveBeenCalledWith(1280, 720);
        });
    });

    // =========================================================================
    // Pass management
    // =========================================================================

    describe('pass management', () => {
        it('should call postprocess_addPass and return index', () => {
            mock.postprocess_addPass.mockReturnValue(2);
            const index = PostProcess.addPass('bloom', 10);
            expect(mock.postprocess_addPass).toHaveBeenCalledWith('bloom', 10);
            expect(index).toBe(2);
        });

        it('should call postprocess_removePass', () => {
            PostProcess.removePass('bloom');
            expect(mock.postprocess_removePass).toHaveBeenCalledWith('bloom');
        });

        it('should call postprocess_setPassEnabled', () => {
            PostProcess.setEnabled('bloom', true);
            expect(mock.postprocess_setPassEnabled).toHaveBeenCalledWith('bloom', true);

            PostProcess.setEnabled('bloom', false);
            expect(mock.postprocess_setPassEnabled).toHaveBeenCalledWith('bloom', false);
        });

        it('should call postprocess_isPassEnabled and return result', () => {
            mock.postprocess_isPassEnabled.mockReturnValue(true);
            expect(PostProcess.isEnabled('bloom')).toBe(true);

            mock.postprocess_isPassEnabled.mockReturnValue(false);
            expect(PostProcess.isEnabled('bloom')).toBe(false);
        });

        it('should call postprocess_getPassCount and return count', () => {
            mock.postprocess_getPassCount.mockReturnValue(5);
            expect(PostProcess.getPassCount()).toBe(5);
        });
    });

    // =========================================================================
    // Uniform setting
    // =========================================================================

    describe('uniform setting', () => {
        it('should call postprocess_setUniformFloat', () => {
            PostProcess.setUniform('bloom', 'u_intensity', 0.5);
            expect(mock.postprocess_setUniformFloat).toHaveBeenCalledWith('bloom', 'u_intensity', 0.5);
        });

        it('should call postprocess_setUniformVec4 with destructured values', () => {
            PostProcess.setUniformVec4('bloom', 'u_color', { x: 1, y: 0.5, z: 0.25, w: 1 });
            expect(mock.postprocess_setUniformVec4).toHaveBeenCalledWith('bloom', 'u_color', 1, 0.5, 0.25, 1);
        });
    });

    // =========================================================================
    // Render frame
    // =========================================================================

    describe('render frame', () => {
        it('should call postprocess_begin', () => {
            PostProcess.begin();
            expect(mock.postprocess_begin).toHaveBeenCalledOnce();
        });

        it('should call postprocess_end', () => {
            PostProcess.end();
            expect(mock.postprocess_end).toHaveBeenCalledOnce();
        });
    });

    // =========================================================================
    // Bypass mode
    // =========================================================================

    describe('bypass mode', () => {
        it('should call postprocess_setBypass with true', () => {
            PostProcess.setBypass(true);
            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(true);
        });

        it('should call postprocess_setBypass with false', () => {
            PostProcess.setBypass(false);
            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(false);
        });

        it('should return WASM result from isBypassed', () => {
            mock.postprocess_isBypassed.mockReturnValue(true);
            expect(PostProcess.isBypassed()).toBe(true);

            mock.postprocess_isBypassed.mockReturnValue(false);
            expect(PostProcess.isBypassed()).toBe(false);
        });

        it('should return true for isBypassed when module is null', () => {
            shutdownPostProcessAPI();
            expect(PostProcess.isBypassed()).toBe(true);
        });
    });

    // =========================================================================
    // Built-in effects
    // =========================================================================

    describe('built-in effects', () => {
        it('should create blur shader using Material.createShader', () => {
            const handle = PostProcess.createBlur();
            expect(Material.createShader).toHaveBeenCalledWith(
                expect.stringContaining('a_position'),
                expect.stringContaining('u_intensity'),
            );
            expect(handle).toBe(42);
        });

        it('should create vignette shader using Material.createShader', () => {
            const handle = PostProcess.createVignette();
            expect(Material.createShader).toHaveBeenCalledWith(
                expect.stringContaining('a_position'),
                expect.stringContaining('u_softness'),
            );
            expect(handle).toBe(42);
        });

        it('should create grayscale shader using Material.createShader', () => {
            const handle = PostProcess.createGrayscale();
            expect(Material.createShader).toHaveBeenCalledWith(
                expect.stringContaining('a_position'),
                expect.stringContaining('0.299'),
            );
            expect(handle).toBe(42);
        });

        it('should create chromatic aberration shader using Material.createShader', () => {
            const handle = PostProcess.createChromaticAberration();
            expect(Material.createShader).toHaveBeenCalledWith(
                expect.stringContaining('a_position'),
                expect.stringContaining('u_intensity'),
            );
            expect(handle).toBe(42);
        });

        it('should use the shared POSTPROCESS_VERTEX shader for all effects', () => {
            PostProcess.createBlur();
            PostProcess.createVignette();
            PostProcess.createGrayscale();
            PostProcess.createChromaticAberration();

            const calls = (Material.createShader as ReturnType<typeof vi.fn>).mock.calls;
            const vertexShaders = calls.map((c: unknown[]) => c[0]);
            const firstVertex = vertexShaders[0];
            for (const vs of vertexShaders) {
                expect(vs).toBe(firstVertex);
            }
        });
    });

    // =========================================================================
    // WASM exception safety
    // =========================================================================

    describe('WASM exception safety', () => {
        it('should return false when postprocess_init throws', () => {
            mock.postprocess_init.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(PostProcess.init(800, 600)).toBe(false);
        });

        it('should return -1 when postprocess_addPass throws', () => {
            mock.postprocess_addPass.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(PostProcess.addPass('test', 1)).toBe(-1);
        });

        it('should return 0 when postprocess_getPassCount throws', () => {
            mock.postprocess_getPassCount.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(PostProcess.getPassCount()).toBe(0);
        });

        it('should return false when postprocess_isPassEnabled throws', () => {
            mock.postprocess_isPassEnabled.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(PostProcess.isEnabled('test')).toBe(false);
        });

        it('should not throw when postprocess_shutdown throws', () => {
            mock.postprocess_shutdown.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(() => PostProcess.shutdown()).not.toThrow();
        });

        it('should not throw when postprocess_resize throws', () => {
            mock.postprocess_resize.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(() => PostProcess.resize(800, 600)).not.toThrow();
        });

        it('should not throw when postprocess_removePass throws', () => {
            mock.postprocess_removePass.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(() => PostProcess.removePass('test')).not.toThrow();
        });

        it('should not throw when postprocess_begin throws', () => {
            mock.postprocess_begin.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(() => PostProcess.begin()).not.toThrow();
        });

        it('should not throw when postprocess_end throws', () => {
            mock.postprocess_end.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(() => PostProcess.end()).not.toThrow();
        });

        it('should return true when postprocess_isBypassed throws', () => {
            mock.postprocess_isBypassed.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(PostProcess.isBypassed()).toBe(true);
        });

        it('should return false when postprocess_isInitialized throws', () => {
            mock.postprocess_isInitialized.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(PostProcess.isInitialized()).toBe(false);
        });
    });
});
