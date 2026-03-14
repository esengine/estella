import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    Renderer,
    RenderStage,
    initRendererAPI,
    shutdownRendererAPI,
} from '../src/renderer';
import type { RenderStats } from '../src/renderer';
import type { ESEngineModule } from '../src/wasm';
import { initResourceManager, shutdownResourceManager } from '../src/resourceManager';

// =============================================================================
// Mock WASM module for Renderer API
// =============================================================================

function createRendererMockModule() {
    const heapBuffer = new ArrayBuffer(1024 * 1024);

    const resourceManager = {
        measureBitmapText: vi.fn(() => ({ width: 120, height: 30 })),
    };

    const mock = {
        _malloc: vi.fn((size: number) => size),
        _free: vi.fn(),
        HEAPF32: new Float32Array(heapBuffer),

        renderer_init: vi.fn(),
        renderer_resize: vi.fn(),
        renderer_begin: vi.fn(),
        renderer_flush: vi.fn(),
        renderer_end: vi.fn(),

        renderer_beginFrame: vi.fn(),
        renderer_updateTransforms: vi.fn(),
        renderer_submitAll: vi.fn(),

        renderer_createTarget: vi.fn(() => 42),
        renderer_releaseTarget: vi.fn(),
        renderer_getTargetTexture: vi.fn(() => 100),
        renderer_getTargetDepthTexture: vi.fn(() => 200),

        renderer_setClearColor: vi.fn(),
        renderer_setViewport: vi.fn(),
        renderer_setScissor: vi.fn(),
        renderer_clearBuffers: vi.fn(),
        renderer_setStage: vi.fn(),

        renderer_getDrawCalls: vi.fn(() => 10),
        renderer_getTriangles: vi.fn(() => 500),
        renderer_getSprites: vi.fn(() => 25),
        renderer_getText: vi.fn(() => 5),
        renderer_getSpine: vi.fn(() => 3),
        renderer_getMeshes: vi.fn(() => 8),
        renderer_getCulled: vi.fn(() => 12),

        resourceManager,
        getResourceManager: vi.fn(() => resourceManager),
    };

    return mock;
}

type MockModule = ReturnType<typeof createRendererMockModule>;

// =============================================================================
// Tests
// =============================================================================

describe('Renderer API', () => {
    let mock: MockModule;

    beforeEach(() => {
        mock = createRendererMockModule();
        initResourceManager(mock.getResourceManager() as any);
        initRendererAPI(mock as unknown as ESEngineModule);
    });

    afterEach(() => {
        shutdownRendererAPI();
        shutdownResourceManager();
    });

    // =========================================================================
    // initRendererAPI / shutdownRendererAPI
    // =========================================================================

    describe('initRendererAPI', () => {
        it('should allocate viewProjection buffer (16 * 4 = 64 bytes)', () => {
            expect(mock._malloc).toHaveBeenCalledTimes(1);
            expect(mock._malloc).toHaveBeenCalledWith(64);
        });
    });

    describe('shutdownRendererAPI', () => {
        it('should free viewProjection buffer', () => {
            shutdownRendererAPI();
            expect(mock._free).toHaveBeenCalledTimes(1);
        });

        it('should handle double shutdown gracefully', () => {
            shutdownRendererAPI();
            shutdownRendererAPI();
            expect(mock._free).toHaveBeenCalledTimes(1);
        });
    });

    // =========================================================================
    // Uninitialized guard
    // =========================================================================

    describe('uninitialized guard', () => {
        beforeEach(() => {
            shutdownRendererAPI();
        });

        it('should return silently from begin when uninitialized', () => {
            const vp = new Float32Array(16);
            expect(() => Renderer.begin(vp)).not.toThrow();
            expect(mock.renderer_begin).not.toHaveBeenCalled();
        });

        it('should return all-zero stats when uninitialized', () => {
            const stats = Renderer.getStats();
            expect(stats).toEqual({
                drawCalls: 0,
                triangles: 0,
                sprites: 0,
                text: 0,
                spine: 0,
                meshes: 0,
                culled: 0,
            });
        });

        it('should return zero-size from measureBitmapText when uninitialized', () => {
            const result = Renderer.measureBitmapText(1, 'hello', 16, 0);
            expect(result).toEqual({ width: 0, height: 0 });
        });

        it('should no-op beginFrame when uninitialized', () => {
            Renderer.beginFrame();
            expect(mock.renderer_beginFrame).not.toHaveBeenCalled();
        });

        it('should no-op updateTransforms when uninitialized', () => {
            Renderer.updateTransforms({ _cpp: 1 as any });
            expect(mock.renderer_updateTransforms).not.toHaveBeenCalled();
        });

        it('should no-op submitAll when uninitialized', () => {
            Renderer.submitAll({ _cpp: 1 as any }, 0, 0, 0, 800, 600);
            expect(mock.renderer_submitAll).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // Renderer.init
    // =========================================================================

    describe('Renderer.init', () => {
        it('should call renderer_init with width and height', () => {
            Renderer.init(800, 600);
            expect(mock.renderer_init).toHaveBeenCalledWith(800, 600);
        });
    });

    // =========================================================================
    // Renderer.resize
    // =========================================================================

    describe('Renderer.resize', () => {
        it('should call renderer_resize with width and height', () => {
            Renderer.resize(1024, 768);
            expect(mock.renderer_resize).toHaveBeenCalledWith(1024, 768);
        });
    });

    // =========================================================================
    // Renderer.begin
    // =========================================================================

    describe('Renderer.begin', () => {
        it('should copy viewProjection to HEAPF32 and call renderer_begin', () => {
            const vp = new Float32Array(16);
            for (let i = 0; i < 16; i++) vp[i] = i + 1;

            Renderer.begin(vp);

            const ptr = 64;
            const offset = ptr / 4;
            for (let i = 0; i < 16; i++) {
                expect(mock.HEAPF32[offset + i]).toBe(i + 1);
            }
            expect(mock.renderer_begin).toHaveBeenCalledWith(ptr, 0);
        });

        it('should default target to 0 when not specified', () => {
            Renderer.begin(new Float32Array(16));
            expect(mock.renderer_begin).toHaveBeenCalledWith(expect.any(Number), 0);
        });

        it('should pass target when specified', () => {
            Renderer.begin(new Float32Array(16), 5);
            expect(mock.renderer_begin).toHaveBeenCalledWith(expect.any(Number), 5);
        });
    });

    // =========================================================================
    // Renderer.flush
    // =========================================================================

    describe('Renderer.flush', () => {
        it('should call renderer_flush', () => {
            Renderer.flush();
            expect(mock.renderer_flush).toHaveBeenCalledOnce();
        });
    });

    // =========================================================================
    // Renderer.end
    // =========================================================================

    describe('Renderer.end', () => {
        it('should call renderer_end', () => {
            Renderer.end();
            expect(mock.renderer_end).toHaveBeenCalledOnce();
        });
    });

    // =========================================================================
    // Renderer.beginFrame
    // =========================================================================

    describe('Renderer.beginFrame', () => {
        it('should call renderer_beginFrame', () => {
            Renderer.beginFrame();
            expect(mock.renderer_beginFrame).toHaveBeenCalledOnce();
        });
    });

    // =========================================================================
    // Renderer.updateTransforms
    // =========================================================================

    describe('Renderer.updateTransforms', () => {
        it('should call renderer_updateTransforms with registry._cpp', () => {
            const registry = { _cpp: 99 as any };
            Renderer.updateTransforms(registry);
            expect(mock.renderer_updateTransforms).toHaveBeenCalledWith(99);
        });
    });

    // =========================================================================
    // Renderer.submitAll
    // =========================================================================

    describe('Renderer.submitAll', () => {
        it('should call renderer_submitAll with registry and viewport', () => {
            const registry = { _cpp: 55 as any };
            Renderer.submitAll(registry, 0, 10, 20, 800, 600);
            expect(mock.renderer_submitAll).toHaveBeenCalledWith(55, 0, 10, 20, 800, 600);
        });
    });

    // =========================================================================
    // RenderTarget lifecycle
    // =========================================================================

    describe('RenderTarget lifecycle', () => {
        it('should create render target and return handle from WASM', () => {
            const handle = Renderer.createRenderTarget(256, 256);
            expect(handle).toBe(42);
            expect(mock.renderer_createTarget).toHaveBeenCalledWith(256, 256, 1);
        });

        it('should default flags to 1', () => {
            Renderer.createRenderTarget(128, 128);
            expect(mock.renderer_createTarget).toHaveBeenCalledWith(128, 128, 1);
        });

        it('should pass custom flags', () => {
            Renderer.createRenderTarget(128, 128, 3);
            expect(mock.renderer_createTarget).toHaveBeenCalledWith(128, 128, 3);
        });

        it('should release render target', () => {
            const handle = Renderer.createRenderTarget(256, 256);
            Renderer.releaseRenderTarget(handle);
            expect(mock.renderer_releaseTarget).toHaveBeenCalledWith(handle);
        });

        it('should get target texture', () => {
            const tex = Renderer.getTargetTexture(42);
            expect(tex).toBe(100);
            expect(mock.renderer_getTargetTexture).toHaveBeenCalledWith(42);
        });

        it('should get target depth texture', () => {
            const depthTex = Renderer.getTargetDepthTexture(42);
            expect(depthTex).toBe(200);
            expect(mock.renderer_getTargetDepthTexture).toHaveBeenCalledWith(42);
        });

        it('should return 0 for createRenderTarget when uninitialized', () => {
            shutdownRendererAPI();
            expect(Renderer.createRenderTarget(256, 256)).toBe(0);
        });

        it('should return 0 for getTargetTexture when uninitialized', () => {
            shutdownRendererAPI();
            expect(Renderer.getTargetTexture(1)).toBe(0);
        });

        it('should return 0 for getTargetDepthTexture when uninitialized', () => {
            shutdownRendererAPI();
            expect(Renderer.getTargetDepthTexture(1)).toBe(0);
        });
    });

    // =========================================================================
    // Rendering state
    // =========================================================================

    describe('Rendering state', () => {
        it('should call renderer_setClearColor', () => {
            Renderer.setClearColor(0.1, 0.2, 0.3, 1.0);
            expect(mock.renderer_setClearColor).toHaveBeenCalledWith(0.1, 0.2, 0.3, 1.0);
        });

        it('should call renderer_setViewport', () => {
            Renderer.setViewport(0, 0, 800, 600);
            expect(mock.renderer_setViewport).toHaveBeenCalledWith(0, 0, 800, 600);
        });

        it('should call renderer_setScissor', () => {
            Renderer.setScissor(10, 20, 100, 200, true);
            expect(mock.renderer_setScissor).toHaveBeenCalledWith(10, 20, 100, 200, true);
        });

        it('should call renderer_clearBuffers', () => {
            Renderer.clearBuffers(7);
            expect(mock.renderer_clearBuffers).toHaveBeenCalledWith(7);
        });

        it('should call renderer_setStage', () => {
            Renderer.setStage(RenderStage.Transparent);
            expect(mock.renderer_setStage).toHaveBeenCalledWith(RenderStage.Transparent);
        });
    });

    // =========================================================================
    // RenderStage enum
    // =========================================================================

    describe('RenderStage enum', () => {
        it('should have correct values', () => {
            expect(RenderStage.Background).toBe(0);
            expect(RenderStage.Opaque).toBe(1);
            expect(RenderStage.Transparent).toBe(2);
            expect(RenderStage.Overlay).toBe(3);
        });
    });

    // =========================================================================
    // getStats
    // =========================================================================

    describe('Renderer.getStats', () => {
        it('should aggregate stats from WASM calls', () => {
            const stats = Renderer.getStats();
            expect(stats).toEqual({
                drawCalls: 10,
                triangles: 500,
                sprites: 25,
                text: 5,
                spine: 3,
                meshes: 8,
                culled: 12,
            });
        });

        it('should call all stat getter functions', () => {
            Renderer.getStats();
            expect(mock.renderer_getDrawCalls).toHaveBeenCalledOnce();
            expect(mock.renderer_getTriangles).toHaveBeenCalledOnce();
            expect(mock.renderer_getSprites).toHaveBeenCalledOnce();
            expect(mock.renderer_getText).toHaveBeenCalledOnce();
            expect(mock.renderer_getSpine).toHaveBeenCalledOnce();
            expect(mock.renderer_getMeshes).toHaveBeenCalledOnce();
            expect(mock.renderer_getCulled).toHaveBeenCalledOnce();
        });
    });

    // =========================================================================
    // measureBitmapText
    // =========================================================================

    describe('Renderer.measureBitmapText', () => {
        it('should proxy to resourceManager.measureBitmapText()', () => {
            const result = Renderer.measureBitmapText(1, 'hello', 16, 0);
            expect(result).toEqual({ width: 120, height: 30 });
        });

        it('should pass all arguments to measureBitmapText', () => {
            Renderer.measureBitmapText(7, 'test', 24, 2);
            expect(mock.resourceManager.measureBitmapText).toHaveBeenCalledWith(7, 'test', 24, 2);
        });
    });

    // =========================================================================
    // HEAPF32 viewProjection copy
    // =========================================================================

    describe('HEAPF32 viewProjection copy', () => {
        it('should write Float32Array values at correct offset', () => {
            const vp = new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                10, 20, 0, 1,
            ]);

            Renderer.begin(vp);

            const ptr = 64;
            const offset = ptr / 4;
            expect(mock.HEAPF32[offset + 0]).toBe(1);
            expect(mock.HEAPF32[offset + 5]).toBe(1);
            expect(mock.HEAPF32[offset + 10]).toBe(1);
            expect(mock.HEAPF32[offset + 12]).toBe(10);
            expect(mock.HEAPF32[offset + 13]).toBe(20);
            expect(mock.HEAPF32[offset + 15]).toBe(1);
        });
    });
});
