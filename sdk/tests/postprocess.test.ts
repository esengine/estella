vi.mock('../src/material', () => ({
    Material: {
        createShader: vi.fn().mockReturnValue(42),
        releaseShader: vi.fn(),
    },
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostProcess, PostProcessStack, initPostProcessAPI, shutdownPostProcessAPI } from '../src/postprocess';
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
        postprocess_clearPasses: vi.fn(),
        postprocess_setUniformFloat: vi.fn(),
        postprocess_setUniformVec4: vi.fn(),
        postprocess_isInitialized: vi.fn().mockReturnValue(true),
        postprocess_setBypass: vi.fn(),
        postprocess_setOutputViewport: vi.fn(),
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

        it('should return false from init after shutdown', () => {
            shutdownPostProcessAPI();
            expect(PostProcess.init(800, 600)).toBe(false);
        });

        it('should not throw from shutdown after shutdown', () => {
            shutdownPostProcessAPI();
            expect(() => PostProcess.shutdown()).not.toThrow();
        });

        it('should not throw from setBypass after shutdown', () => {
            shutdownPostProcessAPI();
            expect(() => PostProcess.setBypass(true)).not.toThrow();
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
    // PostProcessStack
    // =========================================================================

    describe('PostProcessStack', () => {
        it('should create a stack with unique id', () => {
            const stack1 = PostProcess.createStack();
            const stack2 = PostProcess.createStack();
            expect(stack1.id).not.toBe(stack2.id);
        });

        it('should add passes and track count', () => {
            const stack = PostProcess.createStack();
            stack.addPass('bloom', 1);
            stack.addPass('blur', 2);
            expect(stack.passCount).toBe(2);
        });

        it('should remove passes by name', () => {
            const stack = PostProcess.createStack();
            stack.addPass('bloom', 1);
            stack.addPass('blur', 2);
            stack.removePass('bloom');
            expect(stack.passCount).toBe(1);
            expect(stack.passes[0].name).toBe('blur');
        });

        it('should set pass enabled state', () => {
            const stack = PostProcess.createStack();
            stack.addPass('bloom', 1);
            stack.setEnabled('bloom', false);
            expect(stack.enabledPassCount).toBe(0);
            stack.setEnabled('bloom', true);
            expect(stack.enabledPassCount).toBe(1);
        });

        it('should set float uniforms on passes', () => {
            const stack = PostProcess.createStack();
            stack.addPass('bloom', 1);
            stack.setUniform('bloom', 'u_intensity', 0.5);
            const pass = stack.passes[0];
            expect(pass.floatUniforms.get('u_intensity')).toBe(0.5);
        });

        it('should set vec4 uniforms on passes', () => {
            const stack = PostProcess.createStack();
            stack.addPass('bloom', 1);
            stack.setUniformVec4('bloom', 'u_color', { x: 1, y: 0.5, z: 0.25, w: 1 });
            const pass = stack.passes[0];
            expect(pass.vec4Uniforms.get('u_color')).toEqual({ x: 1, y: 0.5, z: 0.25, w: 1 });
        });

        it('should enable/disable all passes', () => {
            const stack = PostProcess.createStack();
            stack.addPass('bloom', 1);
            stack.addPass('blur', 2);
            stack.setAllPassesEnabled(false);
            expect(stack.enabledPassCount).toBe(0);
            stack.setAllPassesEnabled(true);
            expect(stack.enabledPassCount).toBe(2);
        });

        it('should mark as destroyed after destroy()', () => {
            const stack = PostProcess.createStack();
            expect(stack.isDestroyed).toBe(false);
            stack.destroy();
            expect(stack.isDestroyed).toBe(true);
        });

        it('should support chaining on addPass/removePass/setEnabled/setUniform', () => {
            const stack = PostProcess.createStack();
            const result = stack
                .addPass('bloom', 1)
                .setEnabled('bloom', true)
                .setUniform('bloom', 'u_intensity', 0.5)
                .removePass('bloom');
            expect(result).toBe(stack);
        });
    });

    // =========================================================================
    // Camera binding
    // =========================================================================

    describe('camera binding', () => {
        it('should bind a stack to a camera entity', () => {
            const stack = PostProcess.createStack();
            PostProcess.bind(1 as any, stack);
            expect(PostProcess.getStack(1 as any)).toBe(stack);
        });

        it('should unbind a camera', () => {
            const stack = PostProcess.createStack();
            PostProcess.bind(1 as any, stack);
            PostProcess.unbind(1 as any);
            expect(PostProcess.getStack(1 as any)).toBeNull();
        });

        it('should return null for unbound camera', () => {
            expect(PostProcess.getStack(99 as any)).toBeNull();
        });

        it('should throw when binding a destroyed stack', () => {
            const stack = PostProcess.createStack();
            stack.destroy();
            expect(() => PostProcess.bind(1 as any, stack)).toThrow('destroyed');
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
    });

    // =========================================================================
    // _applyForCamera
    // =========================================================================

    describe('_applyForCamera', () => {
        it('should set bypass=true when camera has no bound stack', () => {
            PostProcess._applyForCamera(1 as any);
            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(true);
        });

        it('should sync enabled passes to WASM when stack is bound', () => {
            const stack = PostProcess.createStack();
            stack.addPass('bloom', 42);
            stack.setUniform('bloom', 'u_intensity', 0.5);
            PostProcess.bind(1 as any, stack);

            PostProcess._applyForCamera(1 as any);

            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(false);
            expect(mock.postprocess_clearPasses).toHaveBeenCalled();
            expect(mock.postprocess_addPass).toHaveBeenCalledWith('bloom', 42);
            expect(mock.postprocess_setUniformFloat).toHaveBeenCalledWith('bloom', 'u_intensity', 0.5);
        });

        it('should set bypass=true when all passes are disabled', () => {
            const stack = PostProcess.createStack();
            stack.addPass('bloom', 42);
            stack.setEnabled('bloom', false);
            PostProcess.bind(1 as any, stack);

            PostProcess._applyForCamera(1 as any);
            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(true);
        });

        it('should sync vec4 uniforms to WASM', () => {
            const stack = PostProcess.createStack();
            stack.addPass('bloom', 42);
            stack.setUniformVec4('bloom', 'u_color', { x: 1, y: 0.5, z: 0.25, w: 1 });
            PostProcess.bind(1 as any, stack);

            PostProcess._applyForCamera(1 as any);
            expect(mock.postprocess_setUniformVec4).toHaveBeenCalledWith('bloom', 'u_color', 1, 0.5, 0.25, 1);
        });
    });

    // =========================================================================
    // _resetAfterCamera
    // =========================================================================

    describe('_resetAfterCamera', () => {
        it('should clear passes and set bypass=true', () => {
            PostProcess._resetAfterCamera();
            expect(mock.postprocess_clearPasses).toHaveBeenCalled();
            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(true);
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

        it('should not throw when postprocess_shutdown throws', () => {
            mock.postprocess_shutdown.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(() => PostProcess.shutdown()).not.toThrow();
        });

        it('should not throw when postprocess_resize throws', () => {
            mock.postprocess_resize.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(() => PostProcess.resize(800, 600)).not.toThrow();
        });

        it('should return false when postprocess_isInitialized throws', () => {
            mock.postprocess_isInitialized.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(PostProcess.isInitialized()).toBe(false);
        });
    });
});
