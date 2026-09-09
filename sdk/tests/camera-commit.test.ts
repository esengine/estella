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
import { cameraPlugin } from '../src/camera/CameraPlugin';
import { CameraCommit, onCameraCommitChanged } from '../src/camera/CameraCommit';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { RenderPipeline } from '../src/render/renderPipeline';
import { setRendererBackend, type RendererBackend } from '../src/render/renderer';
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
            beginScreenOverlay: () => {}, submitScreenOverlay: () => {}, endScreenOverlay: () => {},
            setStage: () => {}, setViewport: () => {},
            setYSortLayers: () => {}, setDepthLayers: () => {}, setCullingMask: () => {},
            setViewId: () => {},
            lodInspect: () => null, setLodPreview: () => {}, lightStatus: () => null, shadowStatus: () => null,
            getStats: () => ({ drawCalls: 0, triangles: 0, sprites: 0, text: 0, skeletal: 0, meshes: 0, culled: 0 }),
        };
    }

    /** An app with one orthographic camera, drawing through the fake backend. */
    function bootWithCamera(viewport = { width: 800, height: 600 }) {
        const { app, module } = bootMockApp();
        const registry = registryOf(module);
        const cam = app.world.spawn('camera') as Entity;
        app.world.insert(cam, Transform, { position: { x: 0, y: 0, z: 0 } });
        app.world.insert(cam, Camera, {
            isActive: true, projectionType: ProjectionType.Orthographic, orthoSize: 300,
        });
        registry.getCameraEntities = () => [cam];
        registry.getCanvasEntities = () => [];
        app.setPipeline(new RenderPipeline());
        setRendererBackend(fakeBackend());
        app.addPlugin(cameraPlugin(() => ({ ...viewport })));
        return { app, cam };
    }

    beforeEach(() => {
        drawnWith = null;
        setPlatform({ now: () => 0, devicePixelRatio: () => 1 } as unknown as PlatformAdapter);
    });
    afterEach(() => { setRendererBackend(null); });

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
