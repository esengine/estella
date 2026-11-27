// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The camera an overlay is allowed to project through.
 *
 * A gizmo drawn over the canvas has to use the camera the canvas was drawn with.
 * UICameraInfo cannot answer that: its matrix is rewritten in place twice a
 * frame — an early peek that must not tick the director's blend, then the
 * authoritative resolve the render system draws from — so a reader on its own
 * clock samples at an arbitrary phase. CameraCommit is the answer, published
 * once, after the submit, as a copy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bootMockApp } from './helpers/mockApp';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';
import { cameraPlugin, renderCameraFrame, syncScreenCameras } from '../src/camera/CameraPlugin';
import { EditorView } from '../src/camera/EditorView';
import { DEFAULT_SCREEN_SCALING, ScreenScaling } from '../src/camera/ScreenScaling';
import { RenderResolution } from '../src/camera/presentPlan';
import { CameraCommit, onCameraCommitChanged } from '../src/camera/CameraCommit';
import { CameraView, PresentedCameraView } from '../src/camera/Camera';
import { BlendCurve, setViewTarget } from '../src/camera/CameraDirector';
import { followRenderOrigin, resetRenderOrigin, setRenderOriginStep } from '../src/render/renderOrigin';
import { screenToUiWorld, uiWorldToScreen } from '../src/ui/util/ui-pick';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { ScreenOverlay, defaultScreenOverlay } from '../src/ui/core/screen-overlay';
import { RenderPipeline } from '../src/render/renderPipeline';
import { PostProcessAPI } from '../src/postprocess';
import { Renderer, setRendererBackend, type RendererBackend } from '../src/render/renderer';
import { RenderTexture } from '../src/render/renderTexture';
import { defineSystem, Schedule } from '../src/ecs/system';
import { Camera, Transform, ProjectionType } from '../src/ecs/component';
import { Query, Mut } from '../src/ecs/query';
import type { Entity } from '../src/types';
import type { CppRegistry } from '../src/wasm';

/** The mock's registry. Its runtime shape is wider than the module type, which
 *  declares a `Registry` constructor rather than this accessor. */
const registryOf = (module: unknown): Record<string, unknown> & CppRegistry =>
    (module as { getRegistry(): unknown }).getRegistry() as Record<string, unknown> & CppRegistry;

describe('the camera a frame was drawn with', () => {
    let drawnWith: Float32Array | null = null;

    function fakeBackend(): RendererBackend {
        return {
            init: () => {}, resize: () => {},
            beginFrame: () => {}, updateTransforms: () => {},
            begin: (viewProjection) => { drawnWith = new Float32Array(viewProjection); },
            submitAll: () => {}, flush: () => {}, end: () => {}, endFrame: () => {},
            hasScreenOverlay: () => false,
            beginScreenOverlay: () => {}, submitScreenOverlay: () => {}, keepScreenOverlay: () => false, hasScreenOverlayEffect: () => false, setScreenOverlayEffect: () => {}, endScreenOverlay: () => {}, drawOverScreen: () => {}, hasDrawOverScreen: () => false,
            setStage: () => {}, setViewport: () => {},
            setYSortLayers: () => {}, setDepthLayers: () => {}, setTreeSortLayers: () => {}, setCullingMask: () => {},
            setViewId: () => {},
            lodInspect: () => null, setLodPreview: () => {}, setViewShading: () => {}, setMeshEdgeBuffers: () => {}, setViewSkinWeights: () => {}, lightStatus: () => null, shadowStatus: () => null,
            getStats: () => ({ drawCalls: 0, gpuDraws: 0, triangles: 0, sprites: 0, text: 0, skeletal: 0, meshes: 0, culled: 0 }),
        };
    }

    /** An app with one orthographic camera, drawing through the fake backend. */
    function bootWithCamera(viewport = { width: 800, height: 600 }, x = 0) {
        const { app, module } = bootMockApp();
        const registry = registryOf(module);
        const cam = app.world.spawn('camera') as Entity;
        app.world.insert(cam, Transform, { position: { x, y: 0, z: 0 }, worldPosition: { x, y: 0, z: 0 } });
        app.world.insert(cam, Camera, {
            isActive: true, projectionType: ProjectionType.Orthographic, orthoSize: 300,
        });
        registry.getCameraEntities = () => [cam];
        registry.getCanvasEntities = () => [];
        app.setPipeline(new RenderPipeline());
        setRendererBackend(fakeBackend());
        app.addPlugin(cameraPlugin(() => ({ ...viewport })));
        return { app, cam, registry };
    }

    beforeEach(() => {
        drawnWith = null;
        setPlatform({ now: () => 0, devicePixelRatio: () => 1 } as unknown as PlatformAdapter);
    });
    afterEach(() => { setRendererBackend(null); resetRenderOrigin(); vi.restoreAllMocks(); });

    it('is published, and names the write it came from', async () => {
        const { app } = bootWithCamera();
        await app.tick(1 / 60);

        const commit = app.getResource(CameraCommit);
        expect(commit.valid).toBe(true);
        expect(commit.revision).toBeGreaterThan(0);
        // The picture and the commit agree — one that named a different matrix
        // would send every overlay somewhere the frame never drew.
        expect(drawnWith).not.toBeNull();
        expect(Array.from(commit.viewProjection)).toEqual(Array.from(drawnWith!));
    });

    it.each(['missing', 'unavailable', 'ready'] as const)('maps the picture under integer scaling with post-processing %s', async support => {
        const { app, cam } = bootWithCamera();
        app.world.update(cam, Camera, data => { data.orthoSize = 200; });
        app.insertResource(ScreenScaling, { ...DEFAULT_SCREEN_SCALING, renderPolicy: RenderResolution.IntegerMultiple });
        const submit = vi.spyOn(app.pipeline!, 'submitScene');
        const pp = new PostProcessAPI();
        vi.spyOn(pp, 'isInitialized').mockReturnValue(support === 'ready');
        vi.spyOn(pp, 'init').mockReturnValue(false);
        vi.spyOn(pp, 'resize').mockImplementation(() => {});
        vi.spyOn(pp, 'setOutputViewport').mockImplementation(() => {});
        vi.spyOn(pp, 'setPresentRequired').mockImplementation(() => {});
        vi.spyOn(pp, 'begin').mockImplementation(() => {});
        vi.spyOn(pp, 'end').mockImplementation(() => {});
        if (support !== 'missing') app.pipeline!.setPostProcess(pp);

        await app.tick(1 / 60);

        if (support === 'ready') {
            expect(submit.mock.lastCall?.[2]).toEqual({ x: 0, y: 0, w: 533, h: 400 });
            expect(pp.setOutputViewport).toHaveBeenCalledWith(133, 100, 533, 400);
            expect(app.getResource(CameraCommit)).toMatchObject({ vpX: 133, vpY: 100, vpW: 533, vpH: 400 });
        } else {
            expect(submit.mock.lastCall?.[2]).toEqual({ x: 0, y: 0, w: 800, h: 600 });
            expect(pp.begin).not.toHaveBeenCalled();
            expect(app.getResource(CameraCommit)).toMatchObject({ vpX: 0, vpY: 0, vpW: 800, vpH: 600 });
            expect(app.getResource(UICameraInfo)).toMatchObject({ vpX: 0, vpY: 0, vpW: 800, vpH: 600 });
            expect(app.getResource(PresentedCameraView).screenToWorld(600, 450)?.y).toBeCloseTo(100);
        }
    });

    it('projects and picks where the renderer draws a distant rebased camera', async () => {
        const x = 7 * 2 ** 26 + 32;
        setRenderOriginStep(1024);
        const { app } = bootWithCamera(undefined, x);
        await app.tick(1 / 60);

        expect(drawnWith?.[12]).toBeCloseTo(-32 / 400);
        const sampleX = 424;
        const presented = app.getResource(PresentedCameraView);
        const ui = app.getResource(UICameraInfo);
        const committed = app.getResource(CameraCommit).rebasedProjection;
        expect(committed?.origin).toEqual({ x: x - 32, y: 0, z: 0 });
        expect(committed?.viewProjection).toEqual(drawnWith);
        expect(committed?.viewProjection).not.toBe(ui.rebasedProjection?.viewProjection);
        for (const camera of [presented, app.getResource(CameraView)]) {
            expect(camera.screenToWorld(sampleX, 300)?.x).toBeCloseTo(x + 24, 4);
            expect(camera.screenRay(sampleX, 300)?.origin.x).toBeCloseTo(x + 24, 4);
            expect(camera.worldToScreen(x + 24, 0)?.x).toBeCloseTo(sampleX, 4);
        }
        expect(screenToUiWorld(ui, sampleX, 300).x).toBeCloseTo(x + 24, 4);
        expect(uiWorldToScreen(ui, x + 24, 0).x).toBeCloseTo(sampleX, 4);
        ui.rebasedProjection?.viewProjection.fill(99);
        followRenderOrigin(x + 8192, 0, 0);
        expect(presented.screenToWorld(sampleX, 300)?.x).toBeCloseTo(x + 24, 4);
    });

    it.each([0, 1 / 30])('follows the resolved screen view during a camera change lasting %s seconds', async duration => {
        const { app, cam, registry } = bootWithCamera();
        const x = 2 ** 28 + 32;
        const destination = app.world.spawn('distant camera');
        app.world.insert(destination, Transform, { position: { x, y: 0, z: 0 }, worldPosition: { x, y: 0, z: 0 } });
        app.world.insert(destination, Camera, { isActive: true, orthoSize: 300 });
        registry.getCameraEntities = () => [cam, destination];
        setRenderOriginStep(1024);
        setViewTarget(app, cam);
        await app.tick(1 / 60);
        setViewTarget(app, destination, { time: duration, curve: BlendCurve.Linear });
        await app.tick(1 / 60);
        if (duration) await app.tick(1 / 60);

        const center = duration ? x / 2 : x;
        const commit = app.getResource(CameraCommit);
        expect(commit.rebasedProjection?.origin.x).toBe(Math.round(center / 1024) * 1024);
        expect(commit.rebasedProjection?.viewProjection).toEqual(drawnWith);
        expect(app.getResource(PresentedCameraView).screenToWorld(424, 300)?.x).toBeCloseTo(center + 24, 3);
        expect(renderCameraFrame(app, 800, 600)).toBe(true);
        expect(app.getResource(PresentedCameraView).screenToWorld(424, 300)?.x).toBeCloseTo(center + 24, 3);
    });

    it('follows the first presented viewport when a frame consists of split views', async () => {
        const { app, cam, registry } = bootWithCamera();
        const x = 2 ** 28 + 32;
        app.world.update(cam, Camera, data => {
            data.viewport = { x: 0.5, y: 0, z: 0.5, w: 1 };
            data.priority = 10;
        });
        const left = app.world.spawn('left viewport');
        app.world.insert(left, Transform, { worldPosition: { x, y: 0, z: 0 } });
        app.world.insert(left, Camera, { isActive: true, orthoSize: 300, viewport: { x: 0, y: 0, z: 0.5, w: 1 } });
        registry.getCameraEntities = () => [cam, left];
        setRenderOriginStep(1024);
        await app.tick(1 / 60);

        const commit = app.getResource(CameraCommit);
        expect(commit).toMatchObject({ vpX: 0, vpW: 400, rebasedProjection: { origin: { x: x - 32 } } });
        expect(app.getResource(PresentedCameraView).screenToWorld(200, 300)?.x).toBeCloseTo(x, 3);
    });

    it('uses the exact pixel bounds and aspect for a split viewport on an odd-sized surface', async () => {
        const { app, cam } = bootWithCamera({ width: 801, height: 601 });
        app.world.update(cam, Camera, data => { data.viewport = { x: 0.5, y: 0, z: 0.5, w: 0.5 }; });
        const draw = vi.spyOn(app.pipeline!, 'renderCamera');

        await app.tick(1 / 60);

        expect(draw.mock.lastCall?.[0].viewportPixels).toEqual({ x: 401, y: 301, w: 400, h: 300 });
        expect(drawnWith![5] / drawnWith![0]).toBeCloseTo(400 / 300, 6);
        expect(app.getResource(CameraCommit)).toMatchObject({ vpX: 401, vpY: 301, vpW: 400, vpH: 300 });
        expect(app.getResource(PresentedCameraView).worldToScreen(0, 0)).toMatchObject({ x: 601, y: 451 });
        const picked = app.getResource(PresentedCameraView).screenToWorld(601, 451);
        expect(picked?.x).toBeCloseTo(0, 6);
        expect(picked?.y).toBeCloseTo(0, 6);
    });

    it('skips a viewport whose rounded edges enclose no pixels', async () => {
        const { app, cam } = bootWithCamera();
        app.world.update(cam, Camera, data => { data.viewport = { x: 0.51 / 800, y: 0, z: 0.51 / 800, w: 1 }; });
        const draw = vi.spyOn(app.pipeline!, 'renderCamera');

        await app.tick(1 / 60);

        expect(draw).not.toHaveBeenCalled();
        expect(app.getResource(CameraCommit).valid).toBe(false);
        expect(app.getResource(UICameraInfo).valid).toBe(false);
    });

    it('an offscreen camera cannot take over screen picking, commits or HUD layers', async () => {
        const { app, cam } = bootWithCamera();
        const registry = app.world.getCppRegistry() as unknown as Record<string, unknown> & CppRegistry;
        app.insertResource(ScreenOverlay, defaultScreenOverlay());
        app.world.update(cam, Camera, data => { data.cullingMask = 1; });
        const offscreen = app.world.spawn('texture camera');
        app.world.insert(offscreen, Transform, {
            position: { x: 1000, y: 0, z: 0 }, worldPosition: { x: 1000, y: 0, z: 0 },
        });
        vi.spyOn(Renderer, 'createRenderTarget').mockReturnValue(7);
        const target = RenderTexture.create({ width: 129, height: 257 });
        const draws = vi.spyOn(app.pipeline!, 'renderCamera');
        app.world.insert(offscreen, Camera, {
            isActive: true, renderTarget: target._handle, cullingMask: 2, orthoSize: 50,
            viewport: { x: 0.5, y: 0, z: 0.5, w: 0.5 },
        });
        registry.getCameraEntities = () => [cam, offscreen];
        expect(registry.getCamera(cam).cullingMask).toBe(1);
        expect(registry.getCamera(offscreen).renderTarget).toBe(7);
        await app.tick(1 / 60);
        expect(draws.mock.calls.map(([p]) => [p.cameraEntity, p.renderTarget, p.viewportPixels]))
            .toEqual([[offscreen, 7, { x: 65, y: 129, w: 64, h: 128 }], [cam, 0, { x: 0, y: 0, w: 800, h: 600 }]]);
        const ui = app.getResource(UICameraInfo);
        expect(ui.viewProjection[12]).toBeCloseTo(0);
        expect(app.getResource(CameraCommit).viewProjection[12]).toBeCloseTo(0);
        expect(app.getResource(ScreenOverlay).layerMask).toBe(1);
        RenderTexture.release(target);
        draws.mockClear();
        await app.tick(1 / 60);
        expect(draws.mock.calls.map(([p]) => p.cameraEntity)).toEqual([cam]);
        registry.getCameraEntities = () => [offscreen];
        await app.tick(1 / 60);
        expect(app.getResource(UICameraInfo).valid).toBe(false);
        expect(app.getResource(CameraCommit).valid).toBe(false);
        expect(app.getResource(ScreenOverlay).layerMask).toBe(0xFFFFFFFF);
    });

    it('keeps authored render targets in an immediate frame and uses the preview surface for an explicit camera', () => {
        const { app, cam } = bootWithCamera();
        const registry = app.world.getCppRegistry() as unknown as Record<string, unknown> & CppRegistry;
        const offscreen = app.world.spawn('texture camera');
        app.world.insert(offscreen, Transform);
        vi.spyOn(Renderer, 'createRenderTarget').mockReturnValue(8);
        const target = RenderTexture.create({ width: 128, height: 256 });
        app.world.insert(offscreen, Camera, { isActive: true, renderTarget: target._handle, orthoSize: 50 });
        registry.getCameraEntities = () => [cam, offscreen];
        const draws = vi.spyOn(app.pipeline!, 'renderCamera');
        try {
            expect(renderCameraFrame(app, 800, 600)).toBe(true);
            expect(draws.mock.calls.map(([p]) => [p.cameraEntity, p.renderTarget, p.viewportPixels.w, p.viewportPixels.h]))
                .toEqual([[offscreen, 8, 128, 256], [cam, 0, 800, 600]]);
            draws.mockClear();
            expect(renderCameraFrame(app, 320, 180, undefined, 9)).toBe(true);
            expect(draws.mock.calls.map(([p]) => [p.cameraEntity, p.renderTarget, p.viewportPixels.w, p.viewportPixels.h]))
                .toEqual([[offscreen, 8, 128, 256], [cam, 9, 320, 180]]);
            draws.mockClear();
            expect(renderCameraFrame(app, 320, 180, offscreen, 9)).toBe(true);
            const preview = draws.mock.lastCall?.[0];
            expect(preview).toMatchObject({ cameraEntity: offscreen, renderTarget: 9, viewportPixels: { w: 320, h: 180 } });
            expect(preview!.viewProjection[5] / preview!.viewProjection[0]).toBeCloseTo(320 / 180);
        } finally { RenderTexture.release(target); }
    });

    it('is a copy, so a later write cannot move it under a reader', async () => {
        const { app } = bootWithCamera();
        await app.tick(1 / 60);
        const commit = app.getResource(CameraCommit);
        const held = new Float32Array(commit.viewProjection);

        // What the engine does to UICameraInfo between an overlay's two reads.
        const uiCam = app.getResource(UICameraInfo);
        uiCam.viewProjection.fill(99);

        expect(Array.from(commit.viewProjection)).toEqual(Array.from(held));
        expect(commit.viewProjection).not.toBe(uiCam.viewProjection);
    });

    it('advances once per drawn frame, never backwards', async () => {
        const { app } = bootWithCamera();
        const seen: number[] = [];
        for (let i = 0; i < 3; i++) {
            await app.tick(1 / 60);
            seen.push(app.getResource(CameraCommit).revision);
        }
        expect(seen).toEqual([...seen].sort((a, b) => a - b));
        expect(new Set(seen).size).toBe(seen.length);
    });

    it('is BEHIND the live resource mid-frame, which is the reason it exists', async () => {
        // The early peek moves UICameraInfo.revision before anything is drawn
        // with it, so a reader landing here holds a camera no frame was ever
        // drawn from: not a stale one, a third state.
        const { app } = bootWithCamera();
        await app.tick(1 / 60);

        let midFrame = -1;
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => { midFrame = app.getResource(UICameraInfo).revision; },
            { name: 'readAfterEarlySync' },
        ));
        const committedBefore = app.getResource(CameraCommit).revision;
        await app.tick(1 / 60);

        expect(midFrame).toBeGreaterThan(committedBefore);
        expect(midFrame).not.toBe(app.getResource(CameraCommit).revision);
    });

    it('follows the camera that moved, not the one the peek saw', async () => {
        const { app } = bootWithCamera();
        const SPEED = 300;
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Query(Mut(Transform), Camera)],
            (query) => { query.forEach((_e, t) => { t.position.x += SPEED * (1 / 60); }); },
            { name: 'cameraMove' },
        ));
        await app.tick(1 / 60);

        const commit = app.getResource(CameraCommit);
        expect(Array.from(commit.viewProjection)).toEqual(Array.from(drawnWith!));
    });

    it('announces a change, not a commit', async () => {
        // A commit happens every drawn frame, so a listener told about commits is
        // told 60 times a second that nothing happened. Anything aligning to the
        // picture would then either poll or repaint forever.
        const { app } = bootWithCamera();
        let told = 0;
        const off = onCameraCommitChanged(() => { told++; });
        try {
            await app.tick(1 / 60);
            const first = told;
            expect(first).toBeGreaterThan(0);
            for (let i = 0; i < 5; i++) await app.tick(1 / 60);
            expect(told).toBe(first);
        } finally { off(); }
    });

    it('announces again the moment the projection moves', async () => {
        // Through the viewport, because this fake backend resolves no transforms
        // and the mock registry does not read a component written back by hand.
        const viewport = { width: 800, height: 600 };
        const { app } = bootWithCamera(viewport);
        await app.tick(1 / 60);
        let told = 0;
        const off = onCameraCommitChanged(() => { told++; });
        try {
            await app.tick(1 / 60);
            expect(told).toBe(0);
            viewport.width = 1200;
            await app.tick(1 / 60);
            expect(told).toBe(1);
        } finally { off(); }
    });

    it('commits a manual redraw of a paused screen and keeps texture previews private', async () => {
        const { app, cam } = bootWithCamera();
        await app.tick(1 / 60);
        app.setPaused(true);
        let notifications = 0;
        const off = onCameraCommitChanged(() => { notifications++; });
        const commit = app.getResource(CameraCommit);
        const revision = commit.revision;
        try {
            expect(renderCameraFrame(app, 320, 180, cam, 9)).toBe(true);
            expect(commit.revision).toBe(revision);
            expect(notifications).toBe(0);
            syncScreenCameras(app, 1200, 600);
            expect(commit.vpW).toBe(800);
            expect(notifications).toBe(0);
            expect(renderCameraFrame(app, 1200, 600)).toBe(true);
            expect(commit.vpW).toBe(1200);
            expect(commit.revision).toBeGreaterThan(revision);
            expect(commit.viewProjection).toEqual(drawnWith);
            expect(notifications).toBe(1);
        } finally { off(); }
    });

    it('updates the render origin during a manual viewport draw without a gameplay tick', () => {
        const { app } = bootWithCamera();
        const x = 2 ** 28 + 32;
        setRenderOriginStep(1024);
        Object.assign(app.getResource(EditorView), { active: true, x, orthoSize: 300 });
        expect(renderCameraFrame(app, 800, 600)).toBe(true);
        const commit = app.getResource(CameraCommit);
        expect(commit.rebasedProjection?.origin.x).toBe(x - 32);
        expect(commit.rebasedProjection?.viewProjection).toEqual(drawnWith);
        expect(app.getResource(PresentedCameraView).screenToWorld(424, 300)?.x).toBeCloseTo(x + 24, 4);
    });

    it('commits the renderer parallax anchor when only the game camera moves', async () => {
        const { app, cam } = bootWithCamera(undefined, 16);
        Object.assign(app.getResource(EditorView), { active: true, parallaxPreview: true, x: 0 });
        const setAnchor = vi.spyOn(Renderer, 'setParallaxAnchor');
        await app.tick(1 / 60);
        const commit = app.getResource(CameraCommit);
        const projection = Float32Array.from(commit.viewProjection);
        expect(setAnchor).toHaveBeenLastCalledWith(true, 16, 0);
        expect(commit).toMatchObject({ parallaxAnchor: { x: 16, y: 0 } });
        const callback = vi.fn(), off = onCameraCommitChanged(callback);
        try {
            app.world.update(cam, Transform, t => { t.position.x = t.worldPosition.x = 64; });
            expect(commit).toMatchObject({ parallaxAnchor: { x: 16, y: 0 } });
            await app.tick(1 / 60);
            expect(setAnchor).toHaveBeenLastCalledWith(true, 64, 0);
            expect(commit).toMatchObject({ parallaxAnchor: { x: 64, y: 0 } });
            expect(commit.viewProjection).toEqual(projection);
            expect(callback).toHaveBeenCalledOnce();
            app.getResource(EditorView).parallaxPreview = false;
            await app.tick(1 / 60);
            expect(setAnchor).toHaveBeenLastCalledWith(true, 0, 0);
            expect(commit.parallaxAnchor).toEqual({ x: 0, y: 0 });
            expect(callback).toHaveBeenCalledTimes(2);
        } finally { off(); }
    });

    it('announces once when the last presented camera disappears', async () => {
        const { app, registry } = bootWithCamera();
        await app.tick(1 / 60);
        const callback = vi.fn();
        const off = onCameraCommitChanged(callback);
        try {
            registry.getCameraEntities = () => [];
            await app.tick(1 / 60);
            await app.tick(1 / 60);
            expect(app.getResource(PresentedCameraView).screenToWorld(400, 300)).toBeNull();
            expect(callback).toHaveBeenCalledTimes(1);
        } finally { off(); }
    });

    it('says nothing when no camera drew', async () => {
        const { app, module } = bootMockApp();
        const registry = registryOf(module);
        registry.getCameraEntities = () => [];
        registry.getCanvasEntities = () => [];
        app.setPipeline(new RenderPipeline());
        setRendererBackend(fakeBackend());
        app.addPlugin(cameraPlugin(() => ({ width: 800, height: 600 })));
        await app.tick(1 / 60);
        expect(app.getResource(CameraCommit).valid).toBe(false);
    });
});
