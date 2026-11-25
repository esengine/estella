// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  previewApp.ts
 * @brief A world of its own on the same engine, to make a picture of one thing in.
 *
 * A prefab thumbnail is the prefab as a scene would show it — laid out, its text
 * shaped, its meshes and sprites drawn — and none of that may touch the world being
 * edited: no entity in its outliner, no draw in its viewport, no reference held by
 * its scene. So the prefab is instantiated in a second App on the same wasm module,
 * stepped by hand, and drawn through the engine's own collect into the preview
 * target ({@link renderPreviewWorld}).
 *
 * What the second App leaves out is the point of it:
 *   * no renderer init, no `corePlugin`: the render facades are the module's and
 *     already up; `corePlugin`'s cleanup would shut them down under the editor.
 *   * no `cameraPlugin`: its render system is the only thing that draws a world into
 *     the frame, so without it nothing here can reach the editor's viewport.
 *   * no input, interaction, behaviour or safe-area plugins: they keep app-wide
 *     singletons (the UI event bus, scroll containers) a second build would take over.
 *   * no asset plugin: the caller's `Assets` is installed, so a texture or font the
 *     editor already loaded is the one drawn here.
 *
 * @experimental Pre-1.0 editor surface.
 */
import { App, constructApp } from './app';
import type { CppRegistry, ESEngineModule } from '../wasm';
import type { Assets as AssetsClass } from '../asset/Assets';
import { Assets, installAssets } from '../asset/AssetPlugin';
import { Localization, type LocalizationAPI } from '../i18n/Localization';
import { uiLayoutPlugin } from '../ui/layout/layout';
import { uiMaskPlugin } from '../ui/render/mask';
import { contentRectPlugin } from '../ui/render/content-rect';
import { rectAnchorsPlugin } from '../ui/layout/rect-anchors';
import { textPlugin } from '../ui/text/plugin';
import { inlineImagePlugin } from '../ui/text/inline-image-plugin';
import { uiRenderOrderPlugin } from '../ui/render/render-order';
import { holdUIHelpersBinding } from '../ui/util/helpers';
import { meshRendererPlugin } from '../render/meshRenderer';
import { ScreenLayout, screenLayoutRect } from '../ui/core/screen-layout';
import { ScreenOverlay, defaultScreenOverlay } from '../ui/core/screen-overlay';
import { UICameraInfo } from '../ui/core/ui-camera-info';
import { DEFAULT_UI_CAMERA_INFO } from './corePlugin';
import { RenderPipeline } from '../render/renderPipeline';
import { loadOwnedSceneWithAssets } from '../scene/scene';
import type { SceneData } from '../scene/scene';
import type { Entity } from '../types';
import { Transform, MeshRenderer, Sprite } from '../ecs/component';
import { UINode } from '../ui/core/ui-node';
import { entityWorldBox, entityBoxCorners, meshWorldBox, uiNodeWorldBox, type EntityBox } from '../ecs/entityBox';
import { ortho, invertViewOrbit, multiply } from '../math/mat4';
import { drawPreview, previewCore, DEFAULT_PREVIEW_ORBIT, type PreviewOrbit } from '../render/assetPreview';

/** @experimental */
export interface PreviewAppOptions {
    /** The editor's asset layer: what the preview draws is what it already loaded. */
    assets: AssetsClass;
    /** The editor's text tables, so a label previews in the language the editor shows. */
    localization?: LocalizationAPI | null;
    /** The design resolution screen UI is laid out against. */
    design: { width: number; height: number };
}

/**
 * Make the preview App. Long-lived: build it once and reuse it, {@link clearPreviewWorld}
 * between pictures — building the text and layout plugins per thumbnail would cost more
 * than the picture.
 * @experimental
 */
export function createPreviewApp(module: ESEngineModule, options: PreviewAppOptions): App {
    const restoreHelpers = holdUIHelpersBinding();
    try {
        return constructApp(app => {
            const registry = new module.Registry() as unknown as CppRegistry;
            app.connectCpp(registry, module, { strict: true, ownedRegistry: true });
            installAssets(app, options.assets);
            if (options.localization) app.insertResource(Localization, options.localization);
            // Fresh buffers: the defaults' matrices are arrays, and an App that
            // spread them would write the editor's UI camera every frame.
            app.insertResource(UICameraInfo, { ...DEFAULT_UI_CAMERA_INFO, viewProjection: new Float32Array(16) });
            app.insertResource(ScreenLayout, screenLayoutRect(null, options.design.width, options.design.height));
            app.insertResource(ScreenOverlay, defaultScreenOverlay());
            // A pipeline nothing runs: the plugins that only lay out what a host can draw
            // (text above all) look for one, and the camera render that would run it is
            // the plugin left out above.
            app.setPipeline(new RenderPipeline());
            for (const plugin of [uiLayoutPlugin, uiMaskPlugin, contentRectPlugin, rectAnchorsPlugin,
                textPlugin, inlineImagePlugin, uiRenderOrderPlugin, meshRendererPlugin]) {
                app.addPlugin(plugin);
            }
        });
    } finally {
        // The layout plugin binds the module-wide UI helpers to the registry it
        // builds on; the editor's app keeps them.
        restoreHelpers();
    }
}

/** Despawn everything the last picture spawned. @experimental */
export function clearPreviewWorld(app: App): void {
    const world = app.world;
    for (const entity of world.getAllEntities()) {
        if (world.valid(entity)) world.despawn(entity);
    }
}

/** Spawn @p scene in the preview world, assets loaded and resolved. @experimental */
export function loadPreviewScene(app: App, scene: SceneData): Promise<Map<number, Entity>> {
    return loadOwnedSceneWithAssets(app.world, scene, { assets: app.getResource(Assets) });
}

/** How a picture of a world is framed. @experimental */
export interface PreviewFraming {
    /** What a camera sees the world through. */
    world: Float32Array;
    /** Screen-space UI, in layout pixels; null when there is none. */
    screen: Float32Array | null;
}

const PAD = 1.08;

function union(boxes: readonly EntityBox[]): { lo: number[]; hi: number[] } | null {
    if (!boxes.length) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const box of boxes) {
        for (const c of entityBoxCorners(box)) {
            lo[0] = Math.min(lo[0], c.x); lo[1] = Math.min(lo[1], c.y); lo[2] = Math.min(lo[2], c.z);
            hi[0] = Math.max(hi[0], c.x); hi[1] = Math.max(hi[1], c.y); hi[2] = Math.max(hi[2], c.z);
        }
    }
    return { lo, hi };
}

/** A front ortho over a rectangle, widened to the picture's aspect so nothing is stretched. */
function flatFraming(lo: number[], hi: number[], aspect: number, depth: number): Float32Array {
    const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
    let hx = Math.max((hi[0] - lo[0]) / 2, 1e-3) * PAD, hy = Math.max((hi[1] - lo[1]) / 2, 1e-3) * PAD;
    if (hx / hy > aspect) hy = hx / aspect; else hx = hy * aspect;
    return new Float32Array(ortho(cx - hx, cx + hx, cy - hy, cy + hy, -depth, depth));
}

/**
 * Frame @p entities for a @p w × @p h picture, the way the asset previews are framed:
 * UI to its laid-out boxes in layout pixels, a mesh from off-axis (or @p orbit) to its
 * bounds, anything flat head-on. Null when nothing among them has an extent.
 * @experimental
 */
export function framePreview(app: App, entities: readonly Entity[], w: number, h: number,
                             orbit: PreviewOrbit = DEFAULT_PREVIEW_ORBIT): PreviewFraming | null {
    const world = app.world;
    const aspect = w / h;
    const ui: EntityBox[] = [], meshes: EntityBox[] = [], flat: EntityBox[] = [];
    for (const e of entities) {
        if (!world.valid(e) || !world.has(e, Transform)) continue;
        if (world.has(e, UINode)) { const b = uiNodeWorldBox(world, e); if (b) ui.push(b); continue; }
        if (world.has(e, MeshRenderer)) { const b = meshWorldBox(world, e); if (b) meshes.push(b); continue; }
        if (world.has(e, Sprite)) { const b = entityWorldBox(world, e); if (b) flat.push(b); }
    }
    const uiBox = union(ui);
    const screen = uiBox ? flatFraming(uiBox.lo, uiBox.hi, aspect, 1e6) : null;

    const meshBox = union([...meshes, ...flat]);
    if (meshes.length && meshBox) {
        const centre = [0, 1, 2].map((i) => (meshBox.lo[i] + meshBox.hi[i]) / 2);
        const radius = Math.max(Math.hypot(meshBox.hi[0] - meshBox.lo[0], meshBox.hi[1] - meshBox.lo[1], meshBox.hi[2] - meshBox.lo[2]) / 2, 1e-4);
        const view = new Float32Array(invertViewOrbit(centre[0], centre[1], centre[2],
            orbit.yaw * Math.PI / 180, orbit.pitch * Math.PI / 180, radius * 4));
        // The box's extent as the eye sees it, so a long thing is framed long.
        let half = 1e-4;
        for (let corner = 0; corner < 8; corner++) {
            const p = [corner & 1 ? meshBox.hi[0] : meshBox.lo[0], corner & 2 ? meshBox.hi[1] : meshBox.lo[1], corner & 4 ? meshBox.hi[2] : meshBox.lo[2]];
            const vx = view[0] * p[0] + view[4] * p[1] + view[8] * p[2] + view[12];
            const vy = view[1] * p[0] + view[5] * p[1] + view[9] * p[2] + view[13];
            half = Math.max(half, Math.abs(vx), Math.abs(vy));
        }
        half *= PAD;
        const hx = aspect >= 1 ? half * aspect : half, hy = aspect >= 1 ? half : half / aspect;
        const proj = new Float32Array(ortho(-hx, hx, -hy, hy, 0.01, radius * 8));
        return { world: new Float32Array(multiply(proj, view)), screen };
    }
    if (meshBox) return { world: flatFraming(meshBox.lo, meshBox.hi, aspect, 1e6), screen };
    if (screen) return { world: new Float32Array(screen), screen };
    return null;
}

/**
 * Point the preview app's text and screen UI at the picture about to be made, so
 * glyphs are shaped for its scale. Step the app after this and before drawing.
 * @experimental
 */
export function aimPreviewWorld(app: App, framing: PreviewFraming, w: number, h: number): void {
    const cam = app.getResource(UICameraInfo);
    cam.viewProjection.set(framing.world);
    cam.vpX = 0; cam.vpY = 0; cam.vpW = w; cam.vpH = h; cam.screenW = w; cam.screenH = h;
    cam.valid = true;
    cam.revision++;
    const overlay = app.getResource(ScreenOverlay);
    if (framing.screen) {
        overlay.projection.set(framing.screen);
        overlay.vpX = 0; overlay.vpY = 0; overlay.vpW = w; overlay.vpH = h;
        overlay.surfaceW = w; overlay.surfaceH = h;
        overlay.active = true;
    } else {
        overlay.active = false;
    }
}

/**
 * Draw the preview world into the preview target and read it back: a camera's
 * view through `framing.world`, then its screen-space UI through `framing.screen`.
 * Null when the engine has no such entry or drew nothing.
 * @experimental
 */
export function renderPreviewWorld(app: App, framing: PreviewFraming, w: number, h: number): Promise<ImageData | null> {
    const module = app.wasmModule as (ESEngineModule & {
        renderer_renderRegistryPreview?(registry: unknown, world: number, screen: number, w: number, h: number): void;
        _malloc?(n: number): number; _free?(p: number): void; HEAPF32?: Float32Array;
    }) | null;
    const core = previewCore(module);
    if (!module || !core || typeof module.renderer_renderRegistryPreview !== 'function' || !module._malloc || !module._free) {
        return Promise.resolve(null);
    }
    const registry = app.world.getCppRegistry();
    const malloc = module._malloc, free = module._free;
    return drawPreview(core, () => {
        const worldPtr = malloc(64), screenPtr = framing.screen ? malloc(64) : 0;
        try {
            const heap = new Float32Array(module.HEAPU8.buffer);
            heap.set(framing.world, worldPtr >>> 2);
            if (framing.screen) heap.set(framing.screen, screenPtr >>> 2);
            module.renderer_renderRegistryPreview!(registry, worldPtr, screenPtr, w, h);
        } finally {
            free(worldPtr);
            if (screenPtr) free(screenPtr);
        }
    });
}
