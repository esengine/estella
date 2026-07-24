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
    // The same stack a headless app runs — scenes, prefabs, timers, gameplay AI —
    // plus input. No renderer: the native C++ core owns drawing and reads the ECS
    // this app authors. assetPlugin is the one exception: it wires the wasm heap,
    // so installNativeAssets below builds the equivalent over the native RM.
    // Assets first: prefabs and scene loading declare it as a required resource.
    installNativeAssets(app, scope);
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
