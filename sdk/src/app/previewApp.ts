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
import { entryPlugin } from '../runtime/entryPlugins';
import { ScreenLayout, screenLayoutRect } from '../ui/core/screen-layout';
import { ScreenOverlay, defaultScreenOverlay } from '../ui/core/screen-overlay';
import { UICameraInfo } from '../ui/core/ui-camera-info';
import { DEFAULT_UI_CAMERA_INFO } from './corePlugin';
import { RenderPipeline } from '../render/renderPipeline';
import { loadOwnedSceneWithAssets } from '../scene/scene';
import type { SceneData } from '../scene/scene';
import type { Entity } from '../types';
import { Transform, MeshRenderer, Parent, ShapeRenderer, Sprite } from '../ecs/component';
import { UINode } from '../ui/core/ui-node';
import { extendEntityBoxBounds, meshWorldBox, shapeWorldBox, spriteWorldBox, uiNodeWorldBox, type EntityBoxBounds } from '../ecs/entityBox';
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
            const importedScene = entryPlugin('importedScene');
            if (importedScene) app.addPlugin(importedScene);
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

/** A front ortho over a rectangle, widened to the picture's aspect so nothing is stretched. */
function flatFraming({ minX, minY, maxX, maxY }: EntityBoxBounds, aspect: number, depth: number): Float32Array {
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    let hx = Math.max((maxX - minX) / 2, 1e-3) * PAD, hy = Math.max((maxY - minY) / 2, 1e-3) * PAD;
    if (hx / hy > aspect) hy = hx / aspect; else hx = hy * aspect;
    return new Float32Array(ortho(cx - hx, cx + hx, cy - hy, cy + hy, -depth, depth));
}

/**
 * Frame @p entities for a @p w × @p h picture, the way the asset previews are framed:
 * UI to its laid-out boxes in layout pixels, a mesh from off-axis (or @p orbit) to its
 * bounds, anything flat head-on. Null when nothing visible among them has an extent.
 * @experimental
 */
export function framePreview(app: App, entities: readonly Entity[], w: number, h: number,
                             orbit: PreviewOrbit = DEFAULT_PREVIEW_ORBIT): PreviewFraming | null {
    const world = app.world;
    const aspect = w / h;
    let uiBounds: EntityBoxBounds | null = null;
    let sceneBounds: EntityBoxBounds | null = null;
    let hasMesh = false;
    for (const e of entities) {
        if (!world.isEntityActive(e) || !world.has(e, Transform)) continue;
        if (world.has(e, UINode)) {
            const box = uiNodeWorldBox(world, e);
            if (box) uiBounds = extendEntityBoxBounds(uiBounds, box);
            continue;
        }
        if (world.has(e, MeshRenderer) && world.get(e, MeshRenderer).enabled !== false) {
            const box = meshWorldBox(world, e);
            if (box) {
                sceneBounds = extendEntityBoxBounds(sceneBounds, box);
                hasMesh = true;
            }
        }
        const sprite = world.tryGet(e, Sprite);
        const shape = world.tryGet(e, ShapeRenderer);
        if ((sprite && sprite.enabled !== false) || (shape && shape.enabled !== false)) {
            const transform = world.get(e, Transform);
            if (sprite && sprite.enabled !== false) {
                sceneBounds = extendEntityBoxBounds(sceneBounds, spriteWorldBox(transform, sprite, world.has(e, Parent)));
            }
            if (shape && shape.enabled !== false) sceneBounds = extendEntityBoxBounds(sceneBounds, shapeWorldBox(transform, shape));
        }
    }
    const screen = uiBounds ? flatFraming(uiBounds, aspect, 1e6) : null;

    if (hasMesh && sceneBounds) {
        const { minX, minY, minZ, maxX, maxY, maxZ } = sceneBounds;
        const radius = Math.max(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2, 1e-4);
        const view = new Float32Array(invertViewOrbit((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2,
            orbit.yaw * Math.PI / 180, orbit.pitch * Math.PI / 180, radius * 4));
        // The box's extent as the eye sees it, so a long thing is framed long.
        let half = 1e-4;
        for (let corner = 0; corner < 8; corner++) {
            const x = corner & 1 ? maxX : minX, y = corner & 2 ? maxY : minY, z = corner & 4 ? maxZ : minZ;
            const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
            const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
            half = Math.max(half, Math.abs(vx), Math.abs(vy));
        }
        half *= PAD;
        const hx = aspect >= 1 ? half * aspect : half, hy = aspect >= 1 ? half : half / aspect;
        const proj = new Float32Array(ortho(-hx, hx, -hy, hy, 0.01, radius * 8));
        return { world: new Float32Array(multiply(proj, view)), screen };
    }
    if (sceneBounds) return { world: flatFraming(sceneBounds, aspect, 1e6), screen };
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
 * `studio` lights it with the editor's studio rig at its defaults (what a world with
 * no light of its own needs to be seen at all); otherwise it is lit by its own lights.
 * Either way the viewport's current lighting is not consulted. Null when the engine
 * has no such entry or drew nothing.
 * @experimental
 */
export function renderPreviewWorld(
    app: App, framing: PreviewFraming, w: number, h: number, options?: { studio?: boolean },
): Promise<ImageData | null> {
    const module = app.wasmModule as ESEngineModule | null;
    const core = previewCore(module);
    const registry = app.world.getCppRegistry();
    if (!module || !core || !registry || typeof module.renderer_renderRegistryPreview !== 'function' || !module._malloc || !module._free) {
        return Promise.resolve(null);
    }
    const malloc = module._malloc, free = module._free;
    return drawPreview(core, () => {
        const worldPtr = malloc(64), screenPtr = framing.screen ? malloc(64) : 0;
        try {
            const heap = new Float32Array(module.HEAPU8.buffer);
            heap.set(framing.world, worldPtr >>> 2);
            if (framing.screen) heap.set(framing.screen, screenPtr >>> 2);
            module.renderer_renderRegistryPreview!(registry, worldPtr, screenPtr, options?.studio ? 1 : 0, w, h);
        } finally {
            free(worldPtr);
            if (screenPtr) free(screenPtr);
        }
    });
}
