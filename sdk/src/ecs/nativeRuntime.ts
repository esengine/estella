// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Boot the real SDK ECS World over the native (embedded-Dawn) core.
//
// On web the World is connected to the wasm module's embind Registry; here it is
// connected to the native registry + memory backend, both composed from the host's
// generated bindings (createNativeRegistry / NativeMemoryProvider). The result is
// the SAME World class the web build uses — spawn / insert / get / query / parent
// authoring runs in the JS engine, writing the native C++ ECS, which the native
// host renders. No wasm module: entity generations fall back to World's JS path.

import { App } from '../app';
import { World } from '../world';
import { inputPlugin } from '../input';
import { prefabsPlugin } from '../prefabServer';
import { sceneManagerPlugin } from '../scenePlugin';
import { headlessBasePlugins } from '../webAppFactory';
import { ensureBuiltinComponentsRegistered } from '../component';
import { installNativePlatform, type NativeBridge } from '../platform/native';
import { createNativeRegistry } from './nativeRegistry';
import { NativeMemoryProvider } from './memoryProvider';
import { createNativeResourceManager } from './nativeResourceManager';
import { HOST_FLAGS, TEXT_BINDINGS, hasTextBindings, hasRendererBindings } from './nativeBindings';
import { createNativeRendererBackend, nativeSurfaceSize } from './nativeRenderer';
import { createNativeEngineApi } from './nativeEngineApi.generated';
import { setNativeEngineApi } from './engineApi';
import { setRendererBackend } from '../renderer';
import { RenderPipeline } from '../renderPipeline';
import { cameraPlugin } from '../camera/CameraPlugin';
import { UICameraInfo } from '../ui/core/ui-camera-info';
import { DEFAULT_UI_CAMERA_INFO } from '../corePlugin';
import { uiPlugin } from '../ui/ui-plugin';
import { setNativeTextSubmit } from '../ui/text/submit';
import { initResourceManager } from '../resourceManager';
import { Assets as AssetsClass } from '../asset/Assets';
import { Assets as AssetsResource } from '../asset/AssetPlugin';
import { FileSystemBackend } from '../asset/Backend';
import { platformLoadImagePixels } from '../platform';

/**
 * Create a World bound to the native core. `scope` is where the host installed its
 * bindings (the QuickJS global object on a device; a plain object in tests). The
 * returned World is the real SDK World — the game script authors entities and
 * components through it, and the native host reads the resulting ECS each frame.
 */
export function createNativeWorld(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): World {
    // Idempotent: register every engine component so a scene can't silently drop one
    // (the native entry does this too, but keep the boot self-contained for hosts /
    // tests that call this directly).
    ensureBuiltinComponentsRegistered();

    const world = new World();
    world.connectCpp(createNativeRegistry(scope), undefined, {
        memory: new NativeMemoryProvider(scope),
    });
    return world;
}

/**
 * Boot a native App — the SAME App class the web build uses, over the native core
 * and the native platform. This is the system-binding layer on top of the ECS
 * (Stage B): `installNativePlatform(bridge)` routes the SDK's platform (input, and
 * later assets / audio) to the host's `NativeBridge`; the app runs the standard
 * plugins (input to start) against native ECS. No wasm module and no render plugin
 * — the native C++ host owns rendering and reads the ECS the app authors.
 *
 * The game authors through `app.world` and reads resources like `Input`; drive it
 * with `app.tick(dt)` each frame from the host loop.
 */
export function createNativeApp(
    bridge: NativeBridge,
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): App {
    ensureBuiltinComponentsRegistered();
    // Route the SDK platform to the host before any plugin builds (inputPlugin binds
    // getPlatform().bindInputEvents in build()).
    installNativePlatform(bridge);

    const app = App.new();
    app.connectCpp(createNativeRegistry(scope), undefined, {
        memory: new NativeMemoryProvider(scope),
    });
    // The same order the web app builds in (see _createWebApp): the frame first,
    // then assets, then the gameplay stack. assetPlugin is the one plugin that
    // cannot be shared as-is — it wires the wasm heap — so installNativeAssets
    // builds the equivalent over the native ResourceManager; prefabs and scene
    // loading declare Assets as a required resource, so it precedes them.
    installNativeEngine(scope);
    installNativeRenderer(app, scope);
    installNativeAssets(app, scope);
    installNativeUI(app, scope);
    app.addPlugin(inputPlugin);
    app.addPlugin(prefabsPlugin);
    app.addPlugin(sceneManagerPlugin);
    app.addPlugins(headlessBasePlugins());
    return app;
}

/**
 * Install the native asset channel — the same `Assets` class the web build uses,
 * over the native core. The native analog of the AssetPlugin / runtimeLoader
 * wiring: no wasm module (the {@link createNativeResourceManager} uploads texture
 * bytes directly), a filesystem backend that reads packaged files through the
 * host `NativeBridge`, and the pixel-decode channel (`bridge.loadImagePixels`)
 * wechat / playable also use — so `Assets.loadTexture(path)` returns a handle the
 * native ResourceManager tracks, replacing hand-rolled host texture creation.
 *
 * Kept deliberately lean (no KTX2 side-module / import-settings / ref-counter
 * wiring yet) — those arrive with the cooked-asset manifest in the export
 * pipeline. Same-signature loaders, so it never diverges from the web channel.
 */
/**
 * Install the frame — the same `CameraPlugin` + `RenderPipeline` the web build
 * runs, over the native core.
 *
 * The native host used to write its own frame in C++: one hard-coded projection,
 * collect, flush, present. Every decision the SDK makes about a frame — which
 * cameras exist, their viewport rects and clear flags, the design-resolution fit,
 * y-sort layers, which scenes are active, what draws just before the flush —
 * either had to be written a second time in C++ or was simply absent on device.
 *
 * With the renderer bindings in place the frame is the SDK's one implementation
 * on both platforms, and the host keeps only what is genuinely its own: the
 * swapchain and the present. Gated on the host having bound the whole surface, so
 * a host that still drives its own frame keeps working.
 */
function installNativeEngine(scope: Record<string, unknown>): void {
    // The engine entry points, by the names the wasm module uses — generated from
    // the same C++ declarations embind registers (nativeEngineApi.generated.ts).
    // With this installed, a plugin that calls uiLayout_update / uiHitTest_* /
    // uiRenderOrder_update reaches the native core without knowing it is native.
    setNativeEngineApi(createNativeEngineApi(scope));
}

function installNativeRenderer(app: App, scope: Record<string, unknown>): void {
    if (!hasRendererBindings(scope)) return;
    setRendererBackend(createNativeRendererBackend(scope));
    app.setPipeline(new RenderPipeline());
    app.insertResource(UICameraInfo, { ...DEFAULT_UI_CAMERA_INFO });
    // The viewport is read per frame, so a rotation reaches the projection without
    // anyone pushing a resize event.
    app.addPlugin(cameraPlugin(() => nativeSurfaceSize(scope)));
    // Tell the host to stop drawing its fallback frame: from here the pipeline
    // above opens and closes every pass, and a second one would clear over it.
    scope[HOST_FLAGS.ownsFrame] = true;
}

/**
 * Install the UI — the same `uiPlugin` the web build runs: layout, masks, safe
 * area, text, interaction, behavior, drag, focus and render order.
 *
 * The plugins drive the engine through {@link engineApi}, which answers with the
 * native host's bindings here and with the wasm module on the web, so none of
 * them had to learn about a second core. Two things text cannot take from the
 * web are the glyph source (the device has no 2D canvas — the host's font stack
 * answers through `PlatformAdapter.rasterizeGlyph`) and the batch submit (no wasm
 * heap — the host takes the typed arrays and calls `RenderFrame::submitTextBatch`
 * itself); everything between, atlas through batching, is one implementation.
 *
 * Gated on the host having bound the text surface: one that has not draws no
 * text, exactly as a host without an audio device stays silent.
 */
function installNativeUI(app: App, scope: Record<string, unknown>): void {
    if (!hasTextBindings(scope)) return;

    const submit = scope[TEXT_BINDINGS.submitTextBatch] as (
        vertices: Float32Array, vertexCount: number, indices: Uint16Array, textureId: number,
        transform: Float32Array, entity: number, layer: number, depth: number, sdf: boolean,
    ) => void;
    setNativeTextSubmit((vertices, vertexCount, indices, textureId, transform, entity, layer, depth, sdf) => {
        submit(vertices, vertexCount, indices, textureId, transform, entity, layer, depth, sdf);
    });
    app.addPlugin(uiPlugin);
}

function installNativeAssets(app: App, scope: Record<string, unknown>): void {
    // The host's es_* texture bindings back the SDK's resource surface, so
    // requireResourceManager() resolves for the whole asset path.
    initResourceManager(createNativeResourceManager(scope));

    const assets = AssetsClass.create({
        backend: new FileSystemBackend(),
        module: null,   // no wasm heap on native — the RM takes bytes directly
    });
    // Textures take the Path-2 pixel-decode route: the platform decodes the image
    // to RGBA (bridge.loadImagePixels), then TextureLoader uploads through the
    // native ResourceManager's createTextureFromBytes. `flip` is applied on upload.
    assets.getTextureLoader().setPixelDecoder((path) => platformLoadImagePixels(path));
    app.insertResource(AssetsResource, assets);
}
