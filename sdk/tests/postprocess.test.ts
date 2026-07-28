// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
vi.mock('../src/render/material', () => ({
    Material: {
        createShader: vi.fn().mockReturnValue(42),
        compileShader: vi.fn().mockReturnValue(42),
        releaseShader: vi.fn(),
    },
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostProcessAPI, PostProcessStack, postProcessEffects, initPostProcessAPI, shutdownPostProcessAPI, getEffectDef } from '../src/postprocess';
import { Material } from '../src/render/material';
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
    let pp: PostProcessAPI;

    beforeEach(() => {
        mock = createPostProcessMockModule();
        initPostProcessAPI(mock as unknown as ESEngineModule);
        vi.clearAllMocks();
        pp = new PostProcessAPI();
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
            expect(pp.isInitialized()).toBe(false);
        });

        it('should return false from init after shutdown', () => {
            shutdownPostProcessAPI();
            expect(pp.init(800, 600)).toBe(false);
        });

        it('should not throw from shutdown after shutdown', () => {
            shutdownPostProcessAPI();
            expect(() => pp.shutdown()).not.toThrow();
        });

        it('should not throw from setBypass after shutdown', () => {
            shutdownPostProcessAPI();
            expect(() => pp.setBypass(true)).not.toThrow();
        });
    });

    // =========================================================================
    // Pipeline lifecycle
    // =========================================================================

    describe('pipeline lifecycle', () => {
        it('should call postprocess_init with width and height', () => {
            pp.init(1920, 1080);
            expect(mock.postprocess_init).toHaveBeenCalledWith(1920, 1080);
        });

        it('should return the WASM result from init', () => {
            mock.postprocess_init.mockReturnValue(true);
            expect(pp.init(800, 600)).toBe(true);

            mock.postprocess_init.mockReturnValue(false);
            expect(pp.init(800, 600)).toBe(false);
        });

        it('should call postprocess_shutdown', () => {
            pp.shutdown();
            expect(mock.postprocess_shutdown).toHaveBeenCalledOnce();
        });

        it('should call postprocess_resize with width and height', () => {
            pp.resize(1280, 720);
            expect(mock.postprocess_resize).toHaveBeenCalledWith(1280, 720);
        });
    });

    // =========================================================================
    // PostProcessStack
    // =========================================================================

    describe('PostProcessStack', () => {
        it('should create a stack with unique id', () => {
            const stack1 = pp.createStack();
            const stack2 = pp.createStack();
            expect(stack1.id).not.toBe(stack2.id);
        });

        it('should add passes and track count', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 1);
            stack.addPass('blur', 2);
            expect(stack.passCount).toBe(2);
        });

        it('should remove passes by name', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 1);
            stack.addPass('blur', 2);
            stack.removePass('bloom');
            expect(stack.passCount).toBe(1);
            expect(stack.passes[0].name).toBe('blur');
        });

        it('should set pass enabled state', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 1);
            stack.setEnabled('bloom', false);
            expect(stack.enabledPassCount).toBe(0);
            stack.setEnabled('bloom', true);
            expect(stack.enabledPassCount).toBe(1);
        });

        it('should set float uniforms on passes', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 1);
            stack.setUniform('bloom', 'u_intensity', 0.5);
            const pass = stack.passes[0];
            expect(pass.floatUniforms.get('u_intensity')).toBe(0.5);
        });

        it('should set vec4 uniforms on passes', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 1);
            stack.setUniformVec4('bloom', 'u_color', { x: 1, y: 0.5, z: 0.25, w: 1 });
            const pass = stack.passes[0];
            expect(pass.vec4Uniforms.get('u_color')).toEqual({ x: 1, y: 0.5, z: 0.25, w: 1 });
        });

        it('should enable/disable all passes', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 1);
            stack.addPass('blur', 2);
            stack.setAllPassesEnabled(false);
            expect(stack.enabledPassCount).toBe(0);
            stack.setAllPassesEnabled(true);
            expect(stack.enabledPassCount).toBe(2);
        });

        it('should mark as destroyed after destroy()', () => {
            const stack = pp.createStack();
            expect(stack.isDestroyed).toBe(false);
            stack.destroy();
            expect(stack.isDestroyed).toBe(true);
        });

        it('should support chaining on addPass/removePass/setEnabled/setUniform', () => {
            const stack = pp.createStack();
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
            const stack = pp.createStack();
            pp.bind(1 as any, stack);
            expect(pp.getStack(1 as any)).toBe(stack);
        });

        it('should unbind a camera', () => {
            const stack = pp.createStack();
            pp.bind(1 as any, stack);
            pp.unbind(1 as any);
            expect(pp.getStack(1 as any)).toBeNull();
        });

        it('should return null for unbound camera', () => {
            expect(pp.getStack(99 as any)).toBeNull();
        });

        it('should throw when binding a destroyed stack', () => {
            const stack = pp.createStack();
            stack.destroy();
            expect(() => pp.bind(1 as any, stack)).toThrow('destroyed');
        });
    });

    // =========================================================================
    // Bypass mode
    // =========================================================================

    describe('bypass mode', () => {
        it('should call postprocess_setBypass with true', () => {
            pp.setBypass(true);
            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(true);
        });

        it('should call postprocess_setBypass with false', () => {
            pp.setBypass(false);
            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(false);
        });
    });

    // =========================================================================
    // _applyForCamera
    // =========================================================================

    describe('_applyForCamera', () => {
        it('should set bypass=true when camera has no bound stack', () => {
            pp._applyForCamera(1 as any);
            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(true);
        });

        it('should sync enabled passes to WASM when stack is bound', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 42);
            stack.setUniform('bloom', 'u_intensity', 0.5);
            pp.bind(1 as any, stack);

            pp._applyForCamera(1 as any);

            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(false);
            expect(mock.postprocess_clearPasses).toHaveBeenCalled();
            expect(mock.postprocess_addPass).toHaveBeenCalledWith('bloom', 42);
            expect(mock.postprocess_setUniformFloat).toHaveBeenCalledWith('bloom', 'u_intensity', 0.5);
        });

        it('should set bypass=true when all passes are disabled', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 42);
            stack.setEnabled('bloom', false);
            pp.bind(1 as any, stack);

            pp._applyForCamera(1 as any);
            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(true);
        });

        it('should sync vec4 uniforms to WASM', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 42);
            stack.setUniformVec4('bloom', 'u_color', { x: 1, y: 0.5, z: 0.25, w: 1 });
            pp.bind(1 as any, stack);

            pp._applyForCamera(1 as any);
            expect(mock.postprocess_setUniformVec4).toHaveBeenCalledWith('bloom', 'u_color', 1, 0.5, 0.25, 1);
        });

        // Every camera ends by clearing the engine's pass list, so an unedited
        // stack still has to be re-pushed the next frame. Trusting the stack's
        // dirty flag alone left the engine with zero passes from frame 2 on.
        it('re-pushes an unedited stack after the engine\'s passes were reset', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 42);
            pp.bind(1 as any, stack);

            pp._applyForCamera(1 as any);
            pp._resetAfterCamera();
            mock.postprocess_addPass.mockClear();

            pp._applyForCamera(1 as any);
            expect(mock.postprocess_addPass).toHaveBeenCalledWith('bloom', 42);
        });

        it('does not re-push an unedited stack the engine still holds', () => {
            const stack = pp.createStack();
            stack.addPass('bloom', 42);
            pp.bind(1 as any, stack);

            pp._applyForCamera(1 as any);
            mock.postprocess_addPass.mockClear();

            pp._applyForCamera(1 as any);
            expect(mock.postprocess_addPass).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // _resetAfterCamera
    // =========================================================================

    describe('_resetAfterCamera', () => {
        it('should clear passes and set bypass=true', () => {
            pp._resetAfterCamera();
            expect(mock.postprocess_clearPasses).toHaveBeenCalled();
            expect(mock.postprocess_setBypass).toHaveBeenCalledWith(true);
        });
    });

    // =========================================================================
    // Built-in effects
    // =========================================================================

    describe('built-in effects', () => {
        // Effects are fragment-only PostProcess-domain .esshaders on the
        // reflected #pragma param seam, compiled via Material.compileShader.
        const lastSource = (): string => {
            const calls = (Material.compileShader as ReturnType<typeof vi.fn>).mock.calls;
            return calls[calls.length - 1][0] as string;
        };

        it('should create blur as a param-reflected PostProcess esshader', () => {
            const handle = postProcessEffects.createBlur();
            const src = lastSource();
            expect(src).toContain('#pragma domain PostProcess');
            expect(src).toContain('#pragma param u_intensity float');
            expect(src).not.toContain('#pragma vertex'); // canonical stage is engine-injected
            expect(handle).toBe(42);
        });

        it('should create vignette with its params reflected', () => {
            postProcessEffects.createVignette();
            expect(lastSource()).toContain('#pragma param u_softness float');
        });

        it('should create grayscale with Rec.601 luma weights', () => {
            postProcessEffects.createGrayscale();
            expect(lastSource()).toContain('0.299');
        });

        it('should size chromatic aberration from the injected viewport', () => {
            postProcessEffects.createChromaticAberration();
            const src = lastSource();
            expect(src).toContain('u_intensity * u_viewport.zw');
            expect(src).not.toContain('u_resolution');
        });

        it('should create color grade with every grading param reflected', () => {
            postProcessEffects.createColorGrade();
            const src = lastSource();
            for (const p of ['u_exposure', 'u_contrast', 'u_saturation', 'u_temperature', 'u_tint']) {
                expect(src).toContain(`#pragma param ${p} float`);
            }
        });

        it('registers colorGrade with identity defaults (no-op at defaults)', () => {
            const def = getEffectDef('colorGrade');
            expect(def?.label).toBe('Color Grade');
            const defaults = Object.fromEntries((def?.uniforms ?? []).map(u => [u.name, u.defaultValue]));
            // Identity: 2^0=1, contrast 1, saturation 1, no white-balance shift.
            expect(defaults).toEqual({
                u_exposure: 0, u_contrast: 1, u_saturation: 1, u_temperature: 0, u_tint: 0,
            });
        });

        it('every effect ships a WGSL twin and stays fragment-only', () => {
            postProcessEffects.createLutGrade();
            postProcessEffects.createBlur();
            postProcessEffects.createVignette();
            postProcessEffects.createGrayscale();
            postProcessEffects.createBloomExtract();
            postProcessEffects.createBloomKawase(0);
            postProcessEffects.createBloomComposite();
            postProcessEffects.createColorGrade();
            postProcessEffects.createChromaticAberration();
            postProcessEffects.createTonemap();
            postProcessEffects.createFxaa();
            postProcessEffects.createLensDistortion();
            postProcessEffects.createPixelate();
            postProcessEffects.createOutline();

            const calls = (Material.compileShader as ReturnType<typeof vi.fn>).mock.calls;
            expect(calls.length).toBe(14);
            for (const c of calls) {
                const src = c[0] as string;
                expect(src).toContain('#pragma domain PostProcess');
                expect(src).toContain('#pragma fragment wgsl');
                expect(src).toContain('fn fs_main(');
                expect(src).not.toContain('#pragma vertex');
                expect(src).not.toContain('u_resolution'); // u_viewport replaced it
            }
        });

        it('lutGrade declares the LUT as a texture param', () => {
            postProcessEffects.createLutGrade();
            expect(lastSource()).toContain('#pragma param u_lut texture default(white)');
        });

        it('bloom composite reads the untouched scene through the engine unit', () => {
            postProcessEffects.createBloomComposite();
            const src = lastSource();
            expect(src).toContain('u_sceneTexture'); // GLSL: loose engine sampler (unit 1)
            expect(src).toContain('t1, s1');         // WGSL twin: the unit-1 pair
        });
    });

    // =========================================================================
    // Extended effect library (tonemap / FXAA / lens distortion / pixelate)
    // =========================================================================

    describe('extended effects', () => {
        const lastSource = (): string => {
            const calls = (Material.compileShader as ReturnType<typeof vi.fn>).mock.calls;
            return calls[calls.length - 1][0] as string;
        };

        it('should create an ACES tonemap shader with exposure', () => {
            const handle = postProcessEffects.createTonemap();
            const src = lastSource();
            expect(src).toContain('#pragma param u_exposure float');
            // ACES Narkowicz curve constant — guards the operator identity.
            expect(src).toContain('2.51');
            expect(handle).toBe(42);
        });

        it('should create an FXAA shader sampling by the injected viewport', () => {
            const handle = postProcessEffects.createFxaa();
            const src = lastSource();
            expect(src).toContain('u_viewport.zw');
            expect(src).toContain('#pragma param u_intensity float');
            expect(handle).toBe(42);
        });

        it('should create a lens distortion shader with strength and zoom', () => {
            const handle = postProcessEffects.createLensDistortion();
            const src = lastSource();
            expect(src).toContain('#pragma param u_strength float');
            expect(src).toContain('#pragma param u_zoom float');
            expect(handle).toBe(42);
        });

        it('should create a pixelate shader with pixel size', () => {
            const handle = postProcessEffects.createPixelate();
            expect(lastSource()).toContain('#pragma param u_pixelSize float');
            expect(handle).toBe(42);
        });

        it('should create a Sobel outline shader with intensity/threshold/thickness', () => {
            const handle = postProcessEffects.createOutline();
            const src = lastSource();
            expect(src).toContain('#pragma param u_intensity float');
            expect(src).toContain('#pragma param u_threshold float');
            expect(src).toContain('#pragma param u_thickness float');
            // Rec.601 luma weights — guards the edge-detection identity.
            expect(src).toContain('0.587');
            expect(handle).toBe(42);
        });

        it('registers the extended effects with matching factories and labels', () => {
            expect(getEffectDef('tonemap')?.label).toBe('Tonemap (ACES)');
            expect(getEffectDef('fxaa')?.label).toBe('FXAA');
            expect(getEffectDef('lensDistortion')?.label).toBe('Lens Distortion');
            expect(getEffectDef('pixelate')?.label).toBe('Pixelate');
            expect(getEffectDef('outline')?.label).toBe('Outline');
        });

        it('uses identity defaults where the effect is meant to be tuned up from off', () => {
            const def = (t: string) =>
                Object.fromEntries((getEffectDef(t)?.uniforms ?? []).map(u => [u.name, u.defaultValue]));
            // Tonemap: 2^0 = 1 exposure (the ACES curve itself always applies).
            expect(def('tonemap')).toEqual({ u_exposure: 0 });
            // Lens distortion: strength 0 + zoom 1 == sample uv unchanged (no-op).
            expect(def('lensDistortion')).toEqual({ u_strength: 0, u_zoom: 1 });
            // FXAA full strength by default; pixelate visibly chunky so it reads as on.
            expect(def('fxaa')).toEqual({ u_intensity: 1 });
            expect(def('pixelate')).toEqual({ u_pixelSize: 4 });
            // Outline visible when added (intensity 1); 0 is an exact no-op.
            expect(def('outline')).toEqual({ u_intensity: 1, u_threshold: 0.2, u_thickness: 1 });
        });
    });

    // =========================================================================
    // WASM exception safety
    // =========================================================================

    describe('WASM exception safety', () => {
        it('should return false when postprocess_init throws', () => {
            mock.postprocess_init.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(pp.init(800, 600)).toBe(false);
        });

        it('should not throw when postprocess_shutdown throws', () => {
            mock.postprocess_shutdown.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(() => pp.shutdown()).not.toThrow();
        });

        it('should not throw when postprocess_resize throws', () => {
            mock.postprocess_resize.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(() => pp.resize(800, 600)).not.toThrow();
        });

        it('should return false when postprocess_isInitialized throws', () => {
            mock.postprocess_isInitialized.mockImplementation(() => { throw new Error('WASM crash'); });
            expect(pp.isInitialized()).toBe(false);
        });
    });
});
