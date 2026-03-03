import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/renderer', () => ({
    Renderer: {
        init: vi.fn(),
        resize: vi.fn(),
        begin: vi.fn(),
        flush: vi.fn(),
        end: vi.fn(),
        submitSprites: vi.fn(),
        submitBitmapText: vi.fn(),
        submitSpine: vi.fn(),
        submitParticles: vi.fn(),
        setStage: vi.fn(),
        setClearColor: vi.fn(),
        setViewport: vi.fn(),
        setScissor: vi.fn(),
        clearBuffers: vi.fn(),
    },
}));

vi.mock('../src/postprocess', () => ({
    PostProcess: {
        getStack: vi.fn().mockReturnValue(null),
        resize: vi.fn(),
        setBypass: vi.fn(),
        setOutputViewport: vi.fn(),
        _applyForCamera: vi.fn(),
        _resetAfterCamera: vi.fn(),
        begin: vi.fn(),
        end: vi.fn(),
        screenStack: null,
        isInitialized: vi.fn().mockReturnValue(false),
        init: vi.fn().mockReturnValue(true),
        _applyScreenStack: vi.fn(),
        _beginScreenCapture: vi.fn(),
        _endScreenCapture: vi.fn(),
        _executeScreenPasses: vi.fn(),
    },
}));

vi.mock('../src/draw', () => ({
    Draw: {
        begin: vi.fn(),
        end: vi.fn(),
    },
}));

const mockCallbacks = new Map<string, { fn: (elapsed: number) => void; scene: string }>();
vi.mock('../src/customDraw', () => ({
    getDrawCallbacks: vi.fn(() => mockCallbacks),
    unregisterDrawCallback: vi.fn(),
}));

import { RenderPipeline } from '../src/renderPipeline';
import { Renderer } from '../src/renderer';
import { PostProcess } from '../src/postprocess';
import { Draw } from '../src/draw';
import { getDrawCallbacks, unregisterDrawCallback } from '../src/customDraw';

describe('RenderPipeline', () => {
    let pipeline: RenderPipeline;
    let registry: { _cpp: any };
    let viewProjection: Float32Array;

    beforeEach(() => {
        vi.clearAllMocks();
        mockCallbacks.clear();
        pipeline = new RenderPipeline();
        registry = { _cpp: {} as any };
        viewProjection = new Float32Array(16);
    });

    describe('property setters', () => {
        it('stores spineRenderer via setSpineRenderer', () => {
            const fn = vi.fn();
            pipeline.setSpineRenderer(fn);
            expect(pipeline.spineRenderer).toBe(fn);
        });

        it('returns null for spineRenderer by default', () => {
            expect(pipeline.spineRenderer).toBeNull();
        });

        it('allows clearing spineRenderer with null', () => {
            pipeline.setSpineRenderer(vi.fn());
            pipeline.setSpineRenderer(null);
            expect(pipeline.spineRenderer).toBeNull();
        });

        it('stores maskProcessor via setMaskProcessor', () => {
            const fn = vi.fn();
            pipeline.setMaskProcessor(fn);
            expect(pipeline.maskProcessor).toBe(fn);
        });

        it('returns null for maskProcessor by default', () => {
            expect(pipeline.maskProcessor).toBeNull();
        });

        it('allows clearing maskProcessor with null', () => {
            pipeline.setMaskProcessor(vi.fn());
            pipeline.setMaskProcessor(null);
            expect(pipeline.maskProcessor).toBeNull();
        });

        it('stores active scenes via setActiveScenes', () => {
            const scenes = new Set(['scene1', 'scene2']);
            pipeline.setActiveScenes(scenes);
            pipeline.render({ registry, viewProjection, width: 100, height: 100, elapsed: 0 });
            // No direct getter, but we verify indirectly via callback filtering
        });
    });

    describe('render() call sequence', () => {
        it('calls rendering methods in correct order', () => {
            const callOrder: string[] = [];
            (Renderer.resize as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('resize'));
            (Renderer.setViewport as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('setViewport'));
            (Renderer.clearBuffers as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('clearBuffers'));
            (Renderer.begin as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('begin'));
            (Renderer.submitSprites as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitSprites'));
            (Renderer.submitBitmapText as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitBitmapText'));
            (Renderer.submitSpine as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitSpine'));
            (Renderer.submitParticles as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitParticles'));
            (Renderer.flush as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('flush'));
            (Renderer.end as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('end'));

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(callOrder).toEqual([
                'resize', 'setViewport', 'clearBuffers', 'begin',
                'submitSprites', 'submitBitmapText', 'submitSpine', 'submitParticles',
                'flush', 'end',
            ]);
        });

        it('passes correct arguments to Renderer methods', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(Renderer.resize).toHaveBeenCalledWith(800, 600);
            expect(Renderer.setViewport).toHaveBeenCalledWith(0, 0, 800, 600);
            expect(Renderer.clearBuffers).toHaveBeenCalledWith(3);
            expect(Renderer.begin).toHaveBeenCalledWith(viewProjection);
            expect(Renderer.submitSprites).toHaveBeenCalledWith(registry);
            expect(Renderer.submitBitmapText).toHaveBeenCalledWith(registry);
            expect(Renderer.submitSpine).toHaveBeenCalledWith(registry);
            expect(Renderer.submitParticles).toHaveBeenCalledWith(registry);
        });
    });

    describe('resize detection', () => {
        it('triggers resize on first render', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            expect(Renderer.resize).toHaveBeenCalledWith(800, 600);
        });

        it('does not trigger resize on second render with same size', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            vi.clearAllMocks();
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            expect(Renderer.resize).not.toHaveBeenCalled();
        });

        it('triggers resize again when size changes', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            vi.clearAllMocks();
            pipeline.render({ registry, viewProjection, width: 1024, height: 768, elapsed: 0 });
            expect(Renderer.resize).toHaveBeenCalledWith(1024, 768);
        });

        it('triggers resize when only width changes', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            vi.clearAllMocks();
            pipeline.render({ registry, viewProjection, width: 1024, height: 600, elapsed: 0 });
            expect(Renderer.resize).toHaveBeenCalledWith(1024, 600);
        });

        it('triggers resize when only height changes', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            vi.clearAllMocks();
            pipeline.render({ registry, viewProjection, width: 800, height: 768, elapsed: 0 });
            expect(Renderer.resize).toHaveBeenCalledWith(800, 768);
        });

        it('does not call PostProcess.resize on render() (only renderCamera does)', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            expect(PostProcess.resize).not.toHaveBeenCalled();
        });

        it('calls PostProcess.resize in renderCamera when camera has postprocess stack', () => {
            (PostProcess.getStack as ReturnType<typeof vi.fn>).mockReturnValue({});

            pipeline.renderCamera({
                registry,
                viewProjection,
                viewportPixels: { x: 0, y: 0, w: 800, h: 600 },
                clearFlags: 3,
                elapsed: 0,
                cameraEntity: 1 as any,
            });

            expect(PostProcess.resize).toHaveBeenCalledWith(800, 600);
        });

        it('does not call PostProcess.resize in renderCamera when no postprocess stack', () => {
            (PostProcess.getStack as ReturnType<typeof vi.fn>).mockReturnValue(null);

            pipeline.renderCamera({
                registry,
                viewProjection,
                viewportPixels: { x: 0, y: 0, w: 800, h: 600 },
                clearFlags: 3,
                elapsed: 0,
                cameraEntity: 1 as any,
            });

            expect(PostProcess.resize).not.toHaveBeenCalled();
        });
    });

    describe('spine rendering', () => {
        it('uses Renderer.submitSpine by default', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });
            expect(Renderer.submitSpine).toHaveBeenCalledWith(registry);
        });

        it('uses custom spineRenderer when set', () => {
            const customSpine = vi.fn();
            pipeline.setSpineRenderer(customSpine);
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(customSpine).toHaveBeenCalledWith(registry, 16);
            expect(Renderer.submitSpine).not.toHaveBeenCalled();
        });

        it('reverts to Renderer.submitSpine when spineRenderer cleared', () => {
            const customSpine = vi.fn();
            pipeline.setSpineRenderer(customSpine);
            pipeline.setSpineRenderer(null);
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(Renderer.submitSpine).toHaveBeenCalledWith(registry);
            expect(customSpine).not.toHaveBeenCalled();
        });
    });

    describe('mask processing', () => {
        it('skips mask call when no maskProcessor is set', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            // No maskProcessor means nothing to assert was called - just ensure no error
        });

        it('calls maskProcessor with correct arguments', () => {
            const maskFn = vi.fn();
            pipeline.setMaskProcessor(maskFn);
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(maskFn).toHaveBeenCalledWith(registry._cpp, viewProjection, 0, 0, 800, 600);
        });

        it('calls maskProcessor before submitSprites', () => {
            const callOrder: string[] = [];
            const maskFn = vi.fn(() => callOrder.push('mask'));
            (Renderer.submitSprites as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitSprites'));

            pipeline.setMaskProcessor(maskFn);
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(callOrder).toEqual(['mask', 'submitSprites']);
        });
    });

    describe('custom draw callbacks', () => {
        it('does not call Draw.begin/end when no callbacks', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            expect(Draw.begin).not.toHaveBeenCalled();
            expect(Draw.end).not.toHaveBeenCalled();
        });

        it('calls Draw.begin/end and callback when callbacks exist', () => {
            const cb = vi.fn();
            mockCallbacks.set('test-cb', { fn: cb, scene: '' });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(Draw.begin).toHaveBeenCalledWith(viewProjection);
            expect(cb).toHaveBeenCalledWith(16);
            expect(Draw.end).toHaveBeenCalled();
        });

        it('calls callbacks in correct order within Draw.begin/end', () => {
            const callOrder: string[] = [];
            (Draw.begin as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('Draw.begin'));
            (Draw.end as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('Draw.end'));
            mockCallbacks.set('cb1', { fn: () => callOrder.push('cb1'), scene: '' });
            mockCallbacks.set('cb2', { fn: () => callOrder.push('cb2'), scene: '' });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(callOrder).toEqual(['Draw.begin', 'cb1', 'cb2', 'Draw.end']);
        });

        it('filters callbacks by activeScenes', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            mockCallbacks.set('cb1', { fn: cb1, scene: 'scene-a' });
            mockCallbacks.set('cb2', { fn: cb2, scene: 'scene-b' });

            pipeline.setActiveScenes(new Set(['scene-a']));
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(cb1).toHaveBeenCalled();
            expect(cb2).not.toHaveBeenCalled();
        });

        it('runs callbacks with no scene filter when activeScenes is set', () => {
            const cb = vi.fn();
            mockCallbacks.set('cb-no-scene', { fn: cb, scene: '' });

            pipeline.setActiveScenes(new Set(['scene-a']));
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(cb).toHaveBeenCalled();
        });

        it('runs all callbacks when activeScenes is null', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            mockCallbacks.set('cb1', { fn: cb1, scene: 'scene-a' });
            mockCallbacks.set('cb2', { fn: cb2, scene: 'scene-b' });

            pipeline.setActiveScenes(null);
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(cb1).toHaveBeenCalled();
            expect(cb2).toHaveBeenCalled();
        });

        it('logs error and unregisters throwing callback', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const error = new Error('test error');
            mockCallbacks.set('bad-cb', { fn: () => { throw error; }, scene: '' });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(errorSpy).toHaveBeenCalledWith("[CustomDraw] callback 'bad-cb' error:", error);
            expect(unregisterDrawCallback).toHaveBeenCalledWith('bad-cb');
            errorSpy.mockRestore();
        });

        it('continues executing other callbacks after one throws', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const goodCb = vi.fn();
            mockCallbacks.set('bad-cb', { fn: () => { throw new Error('fail'); }, scene: '' });
            mockCallbacks.set('good-cb', { fn: goodCb, scene: '' });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(goodCb).toHaveBeenCalled();
            expect(unregisterDrawCallback).toHaveBeenCalledWith('bad-cb');
            errorSpy.mockRestore();
        });

        it('still calls Draw.end even when callback throws', () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            mockCallbacks.set('bad-cb', { fn: () => { throw new Error('fail'); }, scene: '' });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(Draw.end).toHaveBeenCalled();
            vi.restoreAllMocks();
        });
    });

    describe('renderCamera()', () => {
        const viewportPixels = { x: 10, y: 20, w: 400, h: 300 };

        it('sets viewport with viewportPixels', () => {
            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 0 });
            expect(Renderer.setViewport).toHaveBeenCalledWith(10, 20, 400, 300);
        });

        it('sets scissor with viewportPixels then resets', () => {
            const callOrder: [string, ...any[]][] = [];
            (Renderer.setScissor as ReturnType<typeof vi.fn>).mockImplementation((...args: any[]) => {
                callOrder.push(['setScissor', ...args]);
            });

            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 0 });

            expect(callOrder).toEqual([
                ['setScissor', 10, 20, 400, 300, true],
                ['setScissor', 0, 0, 0, 0, false],
            ]);
        });

        it('uses clearFlags parameter for clearBuffers', () => {
            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 1, elapsed: 0 });
            expect(Renderer.clearBuffers).toHaveBeenCalledWith(1);
        });

        it('does not trigger resize', () => {
            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 0 });
            expect(Renderer.resize).not.toHaveBeenCalled();
        });

        it('follows same rendering sequence as render() after setup', () => {
            const callOrder: string[] = [];
            (Renderer.setViewport as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('setViewport'));
            (Renderer.setScissor as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('setScissor'));
            (Renderer.clearBuffers as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('clearBuffers'));
            (Renderer.begin as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('begin'));
            (Renderer.submitSprites as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitSprites'));
            (Renderer.submitBitmapText as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitBitmapText'));
            (Renderer.submitSpine as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitSpine'));
            (Renderer.submitParticles as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitParticles'));
            (Renderer.flush as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('flush'));
            (Renderer.end as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('end'));

            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 0 });

            expect(callOrder).toEqual([
                'setViewport', 'setScissor', 'clearBuffers', 'setScissor',
                'begin', 'submitSprites', 'submitBitmapText', 'submitSpine', 'submitParticles',
                'flush', 'end',
            ]);
        });

        it('calls custom spineRenderer in renderCamera', () => {
            const customSpine = vi.fn();
            pipeline.setSpineRenderer(customSpine);
            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 16 });

            expect(customSpine).toHaveBeenCalledWith(registry, 16);
            expect(Renderer.submitSpine).not.toHaveBeenCalled();
        });

        it('calls maskProcessor with viewport params in renderCamera', () => {
            const maskFn = vi.fn();
            pipeline.setMaskProcessor(maskFn);
            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 0 });

            expect(maskFn).toHaveBeenCalledWith(registry._cpp, viewProjection, 10, 20, 400, 300);
        });

        it('executes draw callbacks in renderCamera', () => {
            const cb = vi.fn();
            mockCallbacks.set('cam-cb', { fn: cb, scene: '' });

            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 16 });

            expect(Draw.begin).toHaveBeenCalledWith(viewProjection);
            expect(cb).toHaveBeenCalledWith(16);
            expect(Draw.end).toHaveBeenCalled();
        });
    });

    describe('screen capture', () => {
        it('does not call screen capture when screenStack is null', () => {
            (PostProcess as any).screenStack = null;
            pipeline.beginScreenCapture();
            pipeline.endScreenCapture();
            expect(PostProcess._beginScreenCapture).not.toHaveBeenCalled();
            expect(PostProcess._endScreenCapture).not.toHaveBeenCalled();
            expect(PostProcess._executeScreenPasses).not.toHaveBeenCalled();
        });

        it('calls screen capture when screenStack has enabled passes', () => {
            const mockStack = { enabledPassCount: 1, passes: [] };
            (PostProcess as any).screenStack = mockStack;

            pipeline.beginScreenCapture();
            expect(PostProcess._applyScreenStack).toHaveBeenCalled();
            expect(PostProcess._beginScreenCapture).toHaveBeenCalled();

            pipeline.endScreenCapture();
            expect(PostProcess._endScreenCapture).toHaveBeenCalled();
            expect(PostProcess._executeScreenPasses).toHaveBeenCalled();
        });

        it('does not call screen capture when screenStack has 0 enabled passes', () => {
            const mockStack = { enabledPassCount: 0, passes: [] };
            (PostProcess as any).screenStack = mockStack;

            pipeline.beginScreenCapture();
            pipeline.endScreenCapture();
            expect(PostProcess._beginScreenCapture).not.toHaveBeenCalled();
            expect(PostProcess._executeScreenPasses).not.toHaveBeenCalled();
        });

        it('initializes postprocess if not yet initialized', () => {
            const mockStack = { enabledPassCount: 1, passes: [] };
            (PostProcess as any).screenStack = mockStack;
            (PostProcess.isInitialized as ReturnType<typeof vi.fn>).mockReturnValue(false);

            pipeline.beginScreenCapture();
            expect(PostProcess.init).toHaveBeenCalledWith(1, 1);
        });
    });
});
