import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/renderer', () => ({
    Renderer: {
        init: vi.fn(),
        resize: vi.fn(),
        begin: vi.fn(),
        flush: vi.fn(),
        end: vi.fn(),
        submitSprites: vi.fn(),
        submitShapes: vi.fn(),
        submitBitmapText: vi.fn(),
        submitSpine: vi.fn(),
        submitParticles: vi.fn(),
        submitAll: vi.fn(),
        setStage: vi.fn(),
        setClearColor: vi.fn(),
        setViewport: vi.fn(),
        setScissor: vi.fn(),
        clearBuffers: vi.fn(),
        updateTransforms: vi.fn(),
        beginFrame: vi.fn(),
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
import { unregisterDrawCallback } from '../src/customDraw';

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

    describe('render() call sequence', () => {
        it('calls rendering methods in correct order', () => {
            const callOrder: string[] = [];
            (Renderer.resize as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('resize'));
            (Renderer.setViewport as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('setViewport'));
            (Renderer.clearBuffers as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('clearBuffers'));
            (Renderer.begin as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('begin'));
            (Renderer.submitAll as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitAll'));
            (Renderer.flush as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('flush'));
            (Renderer.end as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('end'));

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(callOrder).toEqual([
                'resize', 'setViewport', 'clearBuffers', 'begin',
                'submitAll', 'flush', 'end',
            ]);
        });

        it('passes correct arguments to Renderer methods', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(Renderer.resize).toHaveBeenCalledWith(800, 600);
            expect(Renderer.setViewport).toHaveBeenCalledWith(0, 0, 800, 600);
            expect(Renderer.clearBuffers).toHaveBeenCalledWith(3);
            expect(Renderer.begin).toHaveBeenCalledWith(viewProjection);
            expect(Renderer.submitAll).toHaveBeenCalledWith(registry, 0, 0, 0, 800, 600);
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

        it('does not call PostProcess.resize on render()', () => {
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
    });

    describe('submitScene', () => {
        it('calls submitAll with skipFlags=0 (all plugins participate)', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });
            expect(Renderer.submitAll).toHaveBeenCalledWith(registry, 0, 0, 0, 800, 600);
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

        it('logs error and unregisters throwing callback', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const error = new Error('test error');
            mockCallbacks.set('bad-cb', { fn: () => { throw error; }, scene: '' });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining("callback 'bad-cb' error"),
                error,
            );
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

        it('passes viewport params to submitAll', () => {
            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 0 });
            expect(Renderer.submitAll).toHaveBeenCalledWith(registry, 0, 10, 20, 400, 300);
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

        it('initializes postprocess if not yet initialized', () => {
            const mockStack = { enabledPassCount: 1, passes: [] };
            (PostProcess as any).screenStack = mockStack;
            (PostProcess.isInitialized as ReturnType<typeof vi.fn>).mockReturnValue(false);

            pipeline.beginScreenCapture();
            expect(PostProcess.init).toHaveBeenCalledWith(1, 1);
        });
    });
});
