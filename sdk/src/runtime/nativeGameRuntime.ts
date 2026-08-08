// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    nativeGameRuntime.ts
 * @brief   Boot an exported project on the native (embedded-Dawn) host — the
 *          native sibling of initWeChatRuntime / the web game host.
 * @details The native app ships this runtime inside the host binary, so an export
 *          is content only: cooked assets, the addressable manifest, the scenes
 *          and `game.config.json`. Everything arrives through the host's
 *          `NativeBridge` (packaged files), and rendering belongs to the native
 *          C++ core — there is no wasm module and no canvas here.
 *
 *          The host drives the frame: call {@link initNativeGame} once, then
 *          `app.tick(dt)` per frame (the returned handle tolerates being ticked
 *          before the async boot settles).
 */

import type { App } from '../app/app';
import { initRuntime } from './runtimeLoader';
import { createNativeApp } from '../ecs/bridge/nativeRuntime';
import type { NativeBridge } from '../platform/native';
import { platformReadTextFile } from '../platform';
import { loadPackagedAssetIndex, createPackagedAssetSource, applyAssetRefResolvers, packagedRuntimeInit, type PackagedGameConfig } from './packagedRuntime';
import type { SceneData } from '../scene/scene';
import { log } from '../util/logger';

export interface NativeGameOptions {
    /** The host's capability bridge (packaged files, image decode, input). */
    bridge: NativeBridge;
    /** Where the host installed its `es_*` bindings; the JS global by default. */
    scope?: Record<string, unknown>;
    /** Surface size in pixels — the camera's aspect comes from it. */
    width: number;
    height: number;
    /** Overrides the packaged config path (default `game.config.json`). */
    configPath?: string;
}

export interface NativeGame {
    app: App;
    config: PackagedGameConfig;
}

/**
 * Boot the exported project: read the config + manifest off the device, index
 * the assets, register every shipped scene and load the entry one.
 */
export async function initNativeGame(options: NativeGameOptions): Promise<NativeGame> {
    const { bridge, scope, width, height } = options;
    const app = createNativeApp(bridge, scope);

    const config = JSON.parse(
        await platformReadTextFile(options.configPath ?? 'game.config.json'),
    ) as PackagedGameConfig;

    const index = await loadPackagedAssetIndex();
    const source = createPackagedAssetSource(index);
    applyAssetRefResolvers(app, index.resolvePath);

    const scenes = config.scenes ?? [{ name: 'main', path: config.entryScene }];
    const entry = scenes.find((s) => s.path === config.entryScene) ?? scenes[0];
    const entryData = JSON.parse(
        await platformReadTextFile(index.resolvePath(config.entryScene)),
    ) as SceneData;

    await initRuntime({
        app,
        module: null,             // the engine core is native here
        source,
        manifest: index.manifest,
        catalog: index.catalog,
        remoteRoot: config.hotUpdate?.remoteRoot,
        persistUpdateKey: config.hotUpdate?.persistUpdateKey,
        scenes: [
            { name: entry.name, data: entryData },
            ...scenes.filter((s) => s.name !== entry.name).map((s) => ({ name: s.name, path: s.path })),
        ],
        firstScene: entry.name,
        aspectRatio: height > 0 ? width / height : undefined,
        // The projection, not a hand-written list: a host that names the fields it
        // knows about is a host the next field never reaches.
        ...packagedRuntimeInit(config),
    });

    log.info('native', `game up — ${scenes.length} scene(s), entry "${entry.name}"`);
    return { app, config };
}
