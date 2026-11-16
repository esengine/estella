// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/render/renderer', () => ({
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
        setCullingMask: vi.fn(),
        setViewId: vi.fn(),
        updateTransforms: vi.fn(),
        beginFrame: vi.fn(),
        hasScreenOverlay: vi.fn().mockReturnValue(true),
        beginScreenOverlay: vi.fn(),
        submitScreenOverlay: vi.fn(),
        endScreenOverlay: vi.fn(),
        hasDrawOverScreen: vi.fn().mockReturnValue(true),
        drawOverScreen: vi.fn(),
    },
}));

vi.mock('../src/postprocess', () => ({
    PostProcess: {
        getStack: vi.fn().mockReturnValue(null),
        resize: vi.fn(),
        setBypass: vi.fn(),
        setQualityFilter: vi.fn(),
        setOutputViewport: vi.fn(),
        setPresentRequired: vi.fn(),
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

vi.mock('../src/render/draw', () => ({
    Draw: {
        begin: vi.fn(),
        end: vi.fn(),
    },
    endPresentedDraw: vi.fn(),
    beginPresentedDraw: vi.fn(),
    // These cases are about a core that HAS a Draw API; the one that has not is
    // covered where the skip lives (nav-debug-draw).
    isDrawAPIReady: () => true,
}));

const mockCallbacks = new Map<string, {
    fn: (elapsed: number, frame: { viewProjection: Float32Array; width: number; height: number }) => void;
    scene: string;
}>();
const mockPreSceneCallbacks = new Map<string, (info: unknown) => void>();
const mockOverScreenCallbacks = new Map<string, (elapsed: number, frame: { viewProjection: Float32Array; width: number; height: number }) => void>();
vi.mock('../src/render/customDraw', () => ({
    getDrawCallbacks: vi.fn(() => mockCallbacks),
    unregisterDrawCallback: vi.fn(),
    getOverScreenDrawCallbacks: vi.fn(() => mockOverScreenCallbacks),
    unregisterOverScreenDrawCallback: vi.fn(),
    getPreSceneDrawCallbacks: vi.fn(() => mockPreSceneCallbacks),
    unregisterPreSceneDrawCallback: vi.fn(),
}));

import { RenderPipeline } from '../src/render/renderPipeline';
import { Renderer } from '../src/render/renderer';
import { PostProcess, type PostProcessAPI } from '../src/postprocess';
import { Draw, beginPresentedDraw, endPresentedDraw } from '../src/render/draw';
import { defaultScreenOverlay } from '../src/ui/core/screen-overlay';
import { unregisterDrawCallback } from '../src/render/customDraw';
const postProcessFixture = PostProcess as unknown as PostProcessAPI;

describe('RenderPipeline', () => {
    let pipeline: RenderPipeline;
    let registry: { _cpp: any };
    let viewProjection: Float32Array;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(postProcessFixture.getStack).mockReturnValue(null);
        vi.mocked(postProcessFixture.isInitialized).mockReturnValue(false);
        vi.mocked(postProcessFixture.init).mockImplementation(() => {
            vi.mocked(postProcessFixture.isInitialized).mockReturnValue(true);
            return true;
        });
        mockCallbacks.clear();
        mockOverScreenCallbacks.clear();
        vi.mocked(Renderer.hasDrawOverScreen).mockReturnValue(true);
        pipeline = new RenderPipeline();
        // PostProcess is now injected (no longer a global the pipeline reaches for).
        pipeline.setPostProcess(postProcessFixture);
        registry = { _cpp: {} as any };
        viewProjection = new Float32Array(16);
    });

    it('draws the over-screen callbacks after the screen overlay, through the last screen camera', () => {
        const order: string[] = [];
        vi.mocked(Renderer.endScreenOverlay).mockImplementation(() => { order.push('overlay'); });
        vi.mocked(Renderer.drawOverScreen).mockImplementation(() => { order.push('over-screen pass'); });
        const seen: Float32Array[] = [];
        mockOverScreenCallbacks.set('handles', (_e, frame) => { order.push('handles'); seen.push(frame.viewProjection); });
        const projection = new Float32Array(16); projection[12] = 5;

        pipeline.beginFrame(0);
        pipeline.renderCamera({ registry, viewProjection: projection,
            viewportPixels: { x: 10, y: 20, w: 800, h: 600 }, clearFlags: 3, elapsed: 0 });
        expect(order).toEqual([]);   // nothing over the screen while the scene draws
        const overlay = defaultScreenOverlay();
        overlay.active = true; overlay.vpW = 800; overlay.vpH = 600;
        pipeline.renderScreenOverlay(registry, overlay);
        pipeline.renderOverScreen();

        expect(order).toEqual(['overlay', 'handles', 'over-screen pass']);
        expect(Array.from(seen[0]!)).toEqual(Array.from(projection));
        expect(Renderer.drawOverScreen).toHaveBeenCalledWith(10, 20, 800, 600, 0);
        // Once a frame: a second call has no camera left to draw through.
        pipeline.renderOverScreen();
        expect(Renderer.drawOverScreen).toHaveBeenCalledTimes(1);
    });

    it('draws the over-screen callbacks with the scene on a core with no over-screen pass', () => {
        vi.mocked(Renderer.hasDrawOverScreen).mockReturnValue(false);
        const handles = vi.fn();
        mockOverScreenCallbacks.set('handles', handles);
        pipeline.beginFrame(0);
        pipeline.renderCamera({ registry, viewProjection,
            viewportPixels: { x: 0, y: 0, w: 800, h: 600 }, clearFlags: 3, elapsed: 0 });
        expect(handles).toHaveBeenCalledTimes(1);
        pipeline.renderOverScreen();
        expect(handles).toHaveBeenCalledTimes(1);
        expect(Renderer.drawOverScreen).not.toHaveBeenCalled();
    });

    it('passes each camera projection and the independent overlay projection to glyph callbacks', () => {
        const world = vi.fn(), screen = vi.fn();
        pipeline.addPreFlushCallback(world);
        pipeline.addScreenOverlayCallback(screen);
        const second = new Float32Array(16); second[12] = 17;
        for (const projection of [viewProjection, second]) {
            pipeline.renderCamera({ registry, viewProjection: projection,
                viewportPixels: { x: 0, y: 0, w: 800, h: 600 }, clearFlags: 3, elapsed: 0 });
        }
        expect(world.mock.calls.map(call => call[1])).toEqual([viewProjection, second]);
        const overlay = defaultScreenOverlay();
        overlay.active = true; overlay.vpW = 800; overlay.vpH = 600;
        pipeline.renderScreenOverlay(registry, overlay);
        expect(screen).toHaveBeenCalledWith(registry, overlay.projection);
        expect(world).toHaveBeenCalledTimes(2);
        pipeline.runPreFlushCallbacks(registry);
        expect(world).toHaveBeenLastCalledWith(registry, undefined);
    });

    describe('render() call sequence', () => {
        it('calls rendering methods in correct order', () => {
            const callOrder: string[] = [];
            (Renderer.resize as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('resize'));
            (Renderer.setViewport as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('setViewport'));
            (Renderer.begin as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('begin'));
            (Renderer.submitAll as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('submitAll'));
            (Renderer.flush as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('flush'));
            (Renderer.end as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('end'));

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(callOrder).toEqual([
                'resize', 'setViewport', 'begin',
                'submitAll', 'flush', 'end',
            ]);
        });

        it('passes correct arguments to Renderer methods', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(Renderer.resize).toHaveBeenCalledWith(800, 600);
            expect(Renderer.setViewport).toHaveBeenCalledWith(0, 0, 800, 600);
            // The clear rides begin as a load-op: color+depth (3), default color.
            expect(Renderer.begin).toHaveBeenCalledWith(viewProjection, 0, 3, undefined);
            expect(Renderer.submitAll).toHaveBeenCalledWith(registry, 0, 0, 800, 600);
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
        it('submits every plugin, with the camera\'s viewport', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });
            expect(Renderer.submitAll).toHaveBeenCalledWith(registry, 0, 0, 800, 600);
        });
    });

    describe('custom draw callbacks', () => {
        it('does not open or close a presented draw when no callbacks', () => {
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            expect(beginPresentedDraw).not.toHaveBeenCalled();
            expect(endPresentedDraw).not.toHaveBeenCalled();
        });

        it('collects a presented draw around callbacks', () => {
            const cb = vi.fn();
            mockCallbacks.set('test-cb', { fn: cb, scene: '' });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(beginPresentedDraw).toHaveBeenCalledWith(viewProjection, 800, 600);
            expect(cb).toHaveBeenCalledWith(16, { viewProjection, width: 800, height: 600 });
            expect(endPresentedDraw).toHaveBeenCalled();
        });

        it('hands callbacks the exact draw-frame camera facts', () => {
            const cb = vi.fn();
            mockCallbacks.set('test-cb', { fn: cb, scene: '' });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 7 });

            const [, frame] = cb.mock.calls[0]!;
            expect(frame.viewProjection).toBe(viewProjection);
            expect(frame).toEqual({ viewProjection, width: 800, height: 600 });
        });

        it('calls callbacks in order before closing the presented draw', () => {
            const callOrder: string[] = [];
            (beginPresentedDraw as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('beginPresentedDraw'));
            (endPresentedDraw as ReturnType<typeof vi.fn>)
                .mockImplementation(() => callOrder.push('endPresentedDraw'));
            mockCallbacks.set('cb1', { fn: () => callOrder.push('cb1'), scene: '' });
            mockCallbacks.set('cb2', { fn: () => callOrder.push('cb2'), scene: '' });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(callOrder).toEqual(['beginPresentedDraw', 'cb1', 'cb2', 'endPresentedDraw']);
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

        it('still closes the presented draw when a callback throws', () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            mockCallbacks.set('bad-cb', { fn: () => { throw new Error('fail'); }, scene: '' });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(endPresentedDraw).toHaveBeenCalled();
            vi.restoreAllMocks();
        });
    });

    describe('renderCamera()', () => {
        const viewportPixels = { x: 10, y: 20, w: 400, h: 300 };

        it('sets viewport with viewportPixels', () => {
            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 0 });
            expect(Renderer.setViewport).toHaveBeenCalledWith(10, 20, 400, 300);
        });

        it('scopes the load-op clear to the camera viewport via begin', () => {
            const bg = { x: 0.1, y: 0.2, z: 0.3, w: 1 };
            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 0, clearColor: bg });
            expect(Renderer.begin).toHaveBeenCalledWith(viewProjection, 0, 3, bg, viewportPixels);
        });

        it('passes viewport params to submitAll', () => {
            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 0 });
            expect(Renderer.submitAll).toHaveBeenCalledWith(registry, 10, 20, 400, 300);
        });

        it('executes draw callbacks in renderCamera', () => {
            const cb = vi.fn();
            mockCallbacks.set('cam-cb', { fn: cb, scene: '' });

            pipeline.renderCamera({ registry, viewProjection, viewportPixels, clearFlags: 3, elapsed: 16 });

            expect(beginPresentedDraw).toHaveBeenCalledWith(viewProjection, 400, 300);
            expect(cb).toHaveBeenCalledWith(16, { viewProjection, width: 400, height: 300 });
            expect(endPresentedDraw).toHaveBeenCalled();
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
