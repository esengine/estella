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
        keepScreenOverlay: vi.fn(() => false),
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

import { RenderPipeline } from '../src/render/renderPipeline';
import { Renderer } from '../src/render/renderer';
import { PostProcess, type PostProcessAPI } from '../src/postprocess';
import { Draw, beginPresentedDraw, endPresentedDraw } from '../src/render/draw';
import { defaultScreenOverlay } from '../src/ui/core/screen-overlay';
import {
    clearDrawCallbacks, getDrawCallbacks, getOverScreenDrawCallbacks, getPreSceneDrawCallbacks,
    registerDrawCallback, registerOverScreenDrawCallback, registerPreSceneDrawCallback,
} from '../src/render/customDraw';
import { World } from '../src/ecs/world';
import { App } from '../src/app/app';
import { addSkeletalSubmit } from '../src/skeletal/submitDomains';
import type { Entity } from '../src/types';
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
        clearDrawCallbacks();
        for (const entry of getOverScreenDrawCallbacks().values()) entry.release();
        for (const entry of getPreSceneDrawCallbacks().values()) entry.release();
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
        registerOverScreenDrawCallback('handles', (_e, frame) => { order.push('handles'); seen.push(frame.viewProjection); });
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

    it('draws render-space overlays through the captured relative projection and origin', () => {
        const canonical = vi.fn(), relative = vi.fn();
        registerOverScreenDrawCallback('normal', canonical);
        registerOverScreenDrawCallback('precise', relative, { renderSpace: true });
        const renderViewProjection = new Float32Array(16).fill(2);
        const renderOrigin = { x: 2 ** 28, y: 0, z: 1024 };
        const parallaxCenter = { x: 96, y: 64 };
        pipeline.beginFrame(0);
        pipeline.renderCamera({ registry, viewProjection, renderViewProjection, renderOrigin, parallaxCenter,
            viewportPixels: { x: 0, y: 0, w: 800, h: 600 }, clearFlags: 3, elapsed: 0 });
        renderOrigin.x = 0;
        parallaxCenter.x = 0;
        renderViewProjection.fill(3);
        pipeline.renderOverScreen();

        const expectedProjection = new Float32Array(16).fill(2);
        expect(canonical.mock.lastCall?.[1]).toEqual({ viewProjection, width: 800, height: 600, parallaxCenter: { x: 96, y: 64 } });
        expect(relative.mock.lastCall?.[1]).toEqual({ viewProjection: expectedProjection, width: 800, height: 600,
            origin: { x: 2 ** 28, y: 0, z: 1024 }, parallaxCenter: { x: 96, y: 64 } });
        expect(beginPresentedDraw).toHaveBeenNthCalledWith(2, expectedProjection, 800, 600);
        expect(Renderer.drawOverScreen).toHaveBeenCalledTimes(2);
    });

    it('uses only the camera of an explicit frame output for over-screen draws', () => {
        const callback = vi.fn();
        registerOverScreenDrawCallback('handles', callback);
        const captured = new Float32Array(16).fill(1);
        pipeline.beginFrame(0, 7);
        pipeline.renderCamera({ registry, viewProjection: captured, renderTarget: 7,
            viewportPixels: { x: 5, y: 10, w: 160, h: 90 }, clearFlags: 3, elapsed: 0 });
        pipeline.renderCamera({ registry, viewProjection, renderTarget: 9,
            viewportPixels: { x: 0, y: 0, w: 128, h: 256 }, clearFlags: 3, elapsed: 0 });
        pipeline.renderOverScreen(9);
        expect(callback).not.toHaveBeenCalled();
        pipeline.renderOverScreen();
        expect(callback.mock.lastCall?.[1]).toEqual({ viewProjection: captured, width: 160, height: 90 });
        expect(Renderer.drawOverScreen).toHaveBeenCalledTimes(1);
        expect(Renderer.drawOverScreen).toHaveBeenCalledWith(5, 10, 160, 90, 7);
    });

    it('keeps the legacy overlay fallback off unrelated texture cameras', () => {
        vi.mocked(Renderer.hasDrawOverScreen).mockReturnValue(false);
        const callback = vi.fn();
        registerOverScreenDrawCallback('handles', callback);
        pipeline.beginFrame(0, 7);
        const params = { registry, viewProjection, viewportPixels: { x: 0, y: 0, w: 128, h: 256 }, clearFlags: 3, elapsed: 0 };
        pipeline.renderCamera({ ...params, renderTarget: 9 });
        expect(callback).not.toHaveBeenCalled();
        pipeline.renderCamera({ ...params, renderTarget: 7 });
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('draws the over-screen callbacks with the scene on a core with no over-screen pass', () => {
        vi.mocked(Renderer.hasDrawOverScreen).mockReturnValue(false);
        const handles = vi.fn();
        registerOverScreenDrawCallback('handles', handles);
        pipeline.beginFrame(0);
        pipeline.renderCamera({ registry, viewProjection,
            viewportPixels: { x: 0, y: 0, w: 800, h: 600 }, clearFlags: 3, elapsed: 0 });
        expect(handles).toHaveBeenCalledTimes(1);
        pipeline.renderOverScreen();
        expect(handles).toHaveBeenCalledTimes(1);
        expect(Renderer.drawOverScreen).not.toHaveBeenCalled();
    });

    it.each(['pre-scene', 'scene', 'over-screen', 'over-screen fallback'])('keeps a %s callback reinstalled before its predecessor throws', phase => {
        const register = phase === 'pre-scene' ? registerPreSceneDrawCallback
            : phase === 'scene' ? registerDrawCallback : registerOverScreenDrawCallback;
        vi.mocked(Renderer.hasDrawOverScreen).mockReturnValue(phase !== 'over-screen fallback');
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        let draws = 0;
        const draw = () => {
            if (++draws === 1) {
                register('hud', draw);
                throw new Error('old registration failed');
            }
        };
        register('hud', draw);
        try {
            for (let i = 0; i < 2; i++) {
                pipeline.beginFrame(i);
                pipeline.renderCamera({ registry, viewProjection, viewportPixels: { x: 0, y: 0, w: 80, h: 60 }, clearFlags: 3, elapsed: i });
                pipeline.renderOverScreen();
            }
            expect(draws).toBe(2);
            expect(error).toHaveBeenCalledOnce();
        } finally { error.mockRestore(); }
    });

    it('starts new registrations on the following pass when a draw removes and reinstalls itself', () => {
        const seen: number[] = [];
        let stop: () => void;
        const draw = () => {
            seen.push(seen.length);
            if (seen.length === 1) { stop(); stop = registerDrawCallback('hud', draw); }
        };
        stop = registerDrawCallback('hud', draw);
        const render = () => pipeline.render({ registry, viewProjection, width: 80, height: 60, elapsed: 0 });
        render();
        expect(seen).toEqual([0]);
        render();
        expect(seen).toEqual([0, 1]);
    });

    it('uses the camera registry and active scene in all three draw phases', () => {
        const a = new World(), b = new World(), preview = { _cpp: {} as typeof registry._cpp };
        vi.spyOn(a, 'getCppRegistry').mockReturnValue(registry._cpp);
        vi.spyOn(b, 'getCppRegistry').mockReturnValue(preview._cpp);
        const calls: string[] = [];
        for (const [label, world] of [['a', a], ['b', b]] as const) {
            registerPreSceneDrawCallback('grid', () => calls.push(label + ' grid'), { world, scene: 'map' });
            registerDrawCallback('hud', () => calls.push(label + ' hud'), { world, scene: 'map' });
            registerOverScreenDrawCallback('handles', () => calls.push(label + ' handles'), { world, scene: 'map' });
        }
        for (const [scene, view] of [['other', registry], ['map', preview], ['map', registry]] as const) {
            pipeline.beginFrame(0);
            pipeline.setActiveScenes(new Set([scene]));
            pipeline.renderCamera({ registry: view, viewProjection, viewportPixels: { x: 0, y: 0, w: 80, h: 60 }, clearFlags: 3, elapsed: 0 });
            pipeline.renderOverScreen();
        }
        expect(Draw.begin).toHaveBeenCalledTimes(2);
        expect(beginPresentedDraw).toHaveBeenCalledTimes(4);
        expect(Renderer.drawOverScreen).toHaveBeenCalledTimes(2);
        expect(calls).toEqual(['b grid', 'b hud', 'b handles', 'a grid', 'a hud', 'a handles']);
    });

    it("uses the presented camera's scenes after another world renders to a texture", () => {
        const screen = new World(), preview = new World(), offscreen = { _cpp: {} as typeof registry._cpp };
        vi.spyOn(screen, 'getCppRegistry').mockReturnValue(registry._cpp);
        vi.spyOn(preview, 'getCppRegistry').mockReturnValue(offscreen._cpp);
        const shown = vi.fn(), hidden = vi.fn(), other = vi.fn();
        registerOverScreenDrawCallback('hud', shown, { world: screen, scene: 'map' });
        registerOverScreenDrawCallback('paused', hidden, { world: screen, scene: 'preview' });
        registerOverScreenDrawCallback('hud', other, { world: preview, scene: 'preview' });
        const camera = { viewProjection, viewportPixels: { x: 0, y: 0, w: 80, h: 60 }, clearFlags: 3, elapsed: 0 };
        pipeline.beginFrame();
        const scenes = new Set(['map']);
        pipeline.setActiveScenes(scenes);
        pipeline.renderCamera({ ...camera, registry });
        scenes.clear();
        scenes.add('preview');
        pipeline.setActiveScenes(scenes);
        pipeline.renderCamera({ ...camera, registry: offscreen, renderTarget: 2 });
        pipeline.renderOverScreen();
        expect(shown).toHaveBeenCalledOnce();
        expect(hidden).not.toHaveBeenCalled();
        expect(other).not.toHaveBeenCalled();
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

    it('asks the engine whether to hold the overlay, with every callback\'s word, and submits nothing to a held pass', () => {
        const screen = vi.fn();
        let still = true;
        pipeline.addScreenOverlayCallback(screen, () => still);
        const overlay = defaultScreenOverlay();
        overlay.active = true; overlay.vpW = 800; overlay.vpH = 600;

        vi.mocked(Renderer.keepScreenOverlay).mockReturnValueOnce(true);
        pipeline.renderScreenOverlay(registry, overlay);
        expect(Renderer.keepScreenOverlay).toHaveBeenLastCalledWith(registry, true);
        expect(Renderer.submitScreenOverlay).not.toHaveBeenCalled();
        expect(screen).not.toHaveBeenCalled();
        expect(Renderer.endScreenOverlay).toHaveBeenCalledTimes(1);

        still = false;
        pipeline.renderScreenOverlay(registry, overlay);
        expect(Renderer.keepScreenOverlay).toHaveBeenLastCalledWith(registry, false);
        expect(Renderer.submitScreenOverlay).toHaveBeenCalledTimes(1);
        expect(screen).toHaveBeenCalledTimes(1);

        // A callback that cannot say holds nothing.
        pipeline.addScreenOverlayCallback(vi.fn());
        still = true;
        pipeline.renderScreenOverlay(registry, overlay);
        expect(Renderer.keepScreenOverlay).toHaveBeenLastCalledWith(registry, false);
    });

    it('asks about the registry being drawn and releases each registration independently', () => {
        const screen = vi.fn(), world = vi.fn();
        const other = { _cpp: {} as typeof registry._cpp };
        const still = vi.fn(owner => owner === other);
        const removeWorld = pipeline.addPreFlushCallback(world);
        const removeScreen = pipeline.addScreenOverlayCallback(screen, still);
        pipeline.addScreenOverlayCallback(screen, () => true);
        const overlay = defaultScreenOverlay();
        overlay.active = true; overlay.vpW = 80; overlay.vpH = 60;
        pipeline.renderScreenOverlay(registry, overlay);
        expect(Renderer.keepScreenOverlay).toHaveBeenLastCalledWith(registry, false);
        pipeline.renderScreenOverlay(other, overlay);
        expect(Renderer.keepScreenOverlay).toHaveBeenLastCalledWith(other, true);
        removeWorld();
        removeScreen();
        removeScreen();
        screen.mockClear();
        pipeline.runPreFlushCallbacks(registry);
        pipeline.renderScreenOverlay(registry, overlay);
        expect(world).not.toHaveBeenCalled();
        expect(screen).toHaveBeenCalledOnce();
        expect(still).toHaveBeenCalledTimes(2);
        expect(Renderer.keepScreenOverlay).toHaveBeenLastCalledWith(registry, false);
        pipeline.renderScreenOverlay(registry, overlay);
        expect(Renderer.keepScreenOverlay).toHaveBeenLastCalledWith(registry, true);
    });

    it('wakes a retained empty skeletal overlay on late binding, enable and hierarchy changes', () => {
        const app = App.new();
        app.setPipeline(pipeline);
        const entity = 4 as Entity;
        let epoch = 0, enabled = false, active = true;
        registry._cpp.activityEpoch = () => epoch;
        vi.spyOn(app.world, 'getCppRegistry').mockReturnValue(registry._cpp);
        vi.spyOn(app.world, 'getWasmModule').mockReturnValue({ ui_isScreenDomain: () => true } as never);
        vi.spyOn(app.world, 'isEntityActive').mockImplementation(() => active);
        let manager: { bindingRevision: number } | null = null;
        const mesh = vi.fn();
        addSkeletalSubmit(app, () => manager, (_, __, include) => {
            if (enabled && include(entity)) mesh();
        });
        const overlay = defaultScreenOverlay();
        overlay.active = true; overlay.vpW = 80; overlay.vpH = 60;
        const frame = (held: boolean) => {
            vi.mocked(Renderer.keepScreenOverlay).mockImplementationOnce((_, still) => still);
            pipeline.renderScreenOverlay(registry, overlay);
            expect(Renderer.keepScreenOverlay).toHaveBeenLastCalledWith(registry, held);
        };
        try {
            frame(false);
            frame(true);
            manager = { bindingRevision: 0 };
            frame(false);
            frame(true);
            enabled = true; ++manager.bindingRevision;
            frame(false);
            expect(mesh).toHaveBeenCalledTimes(1);
            enabled = false; ++manager.bindingRevision;
            frame(false);
            frame(true);
            enabled = true; ++manager.bindingRevision;
            frame(false);
            expect(mesh).toHaveBeenCalledTimes(2);
            active = false; ++epoch;
            frame(false);
            frame(true);
            active = true; ++epoch;
            frame(false);
            expect(mesh).toHaveBeenCalledTimes(3);
        } finally { app.quit({ keepRenderer: true }); }
    });

    it('keeps pass contributions with the owning app across peer installs, registry changes and quit', () => {
        const owner = App.new(), peer = App.new(), other = { _cpp: {} as typeof registry._cpp };
        const ownerRegistry = vi.spyOn(owner.world, 'getCppRegistry').mockReturnValue(registry._cpp);
        vi.spyOn(peer.world, 'getCppRegistry').mockReturnValue(other._cpp);
        const draw = vi.fn(), peerDraw = vi.fn(), peerStill = vi.fn(() => false);
        const overlay = defaultScreenOverlay();
        overlay.active = true; overlay.vpW = 80; overlay.vpH = 60;
        pipeline.addPreFlushCallback(draw, owner);
        pipeline.addScreenOverlayCallback(draw, () => true, owner);
        pipeline.renderScreenOverlay(registry, overlay);
        pipeline.addScreenOverlayCallback(peerDraw, peerStill, peer);
        pipeline.runPreFlushCallbacks(other);
        pipeline.renderScreenOverlay(registry, overlay);
        expect(draw).toHaveBeenCalledTimes(2);
        expect(peerDraw).not.toHaveBeenCalled();
        expect(peerStill).not.toHaveBeenCalled();
        expect(Renderer.keepScreenOverlay).toHaveBeenLastCalledWith(registry, true);
        ownerRegistry.mockReturnValue(other._cpp);
        pipeline.renderScreenOverlay(registry, overlay);
        expect(Renderer.keepScreenOverlay).toHaveBeenLastCalledWith(registry, false);
        pipeline.runPreFlushCallbacks(other);
        expect(draw).toHaveBeenCalledTimes(3);
        owner.quit({ keepRenderer: true });
        pipeline.runPreFlushCallbacks(other);
        pipeline.renderScreenOverlay(other, overlay);
        expect(draw).toHaveBeenCalledTimes(3);
        expect(peerDraw).toHaveBeenCalledOnce();
        peer.quit({ keepRenderer: true });
    });

    it('applies pass removals immediately and starts replacements on the next pass', () => {
        const skipped = vi.fn(), replacement = vi.fn();
        const removeFirst = pipeline.addPreFlushCallback(() => {
            removeFirst();
            removeNext();
            pipeline.addPreFlushCallback(replacement);
        });
        const removeNext = pipeline.addPreFlushCallback(skipped);
        pipeline.runPreFlushCallbacks(registry);
        expect(skipped).not.toHaveBeenCalled();
        expect(replacement).not.toHaveBeenCalled();
        pipeline.runPreFlushCallbacks(registry);
        expect(replacement).toHaveBeenCalledOnce();
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
            registerDrawCallback('test-cb', cb);

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 16 });

            expect(beginPresentedDraw).toHaveBeenCalledWith(viewProjection, 800, 600);
            expect(cb).toHaveBeenCalledWith(16, { viewProjection, width: 800, height: 600 });
            expect(endPresentedDraw).toHaveBeenCalled();
        });

        it('hands callbacks the exact draw-frame camera facts', () => {
            const cb = vi.fn();
            registerDrawCallback('test-cb', cb);

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
            registerDrawCallback('cb1', () => callOrder.push('cb1'));
            registerDrawCallback('cb2', () => callOrder.push('cb2'));

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(callOrder).toEqual(['beginPresentedDraw', 'cb1', 'cb2', 'endPresentedDraw']);
        });

        it('filters callbacks by activeScenes', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            registerDrawCallback('cb1', cb1, 'scene-a');
            registerDrawCallback('cb2', cb2, 'scene-b');

            pipeline.setActiveScenes(new Set(['scene-a']));
            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(cb1).toHaveBeenCalled();
            expect(cb2).not.toHaveBeenCalled();
        });

        it('draws each world overlay only during a pass for its own registry', () => {
            const preview: typeof registry = { _cpp: {} };
            const first = vi.fn(), second = vi.fn();
            const a = new World(), b = new World();
            vi.spyOn(a, 'getCppRegistry').mockReturnValue(registry._cpp);
            vi.spyOn(b, 'getCppRegistry').mockReturnValue(preview._cpp);
            registerDrawCallback('overlay', first, { world: a });
            registerDrawCallback('overlay', second, { world: b });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });
            expect(first).toHaveBeenCalledOnce();
            expect(second).not.toHaveBeenCalled();
            pipeline.render({ registry: preview, viewProjection, width: 800, height: 600, elapsed: 0 });
            expect(first).toHaveBeenCalledOnce();
            expect(second).toHaveBeenCalledOnce();
        });

        it('logs error and unregisters throwing callback', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const error = new Error('test error');
            registerDrawCallback('bad-cb', () => { throw error; });

            pipeline.render({ registry, viewProjection, width: 800, height: 600, elapsed: 0 });

            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining("callback 'bad-cb' error"),
                error,
            );
            expect(getDrawCallbacks().has('bad-cb')).toBe(false);
            errorSpy.mockRestore();
        });

        it('still closes the presented draw when a callback throws', () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            registerDrawCallback('bad-cb', () => { throw new Error('fail'); });

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
            registerDrawCallback('cam-cb', cb);

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
