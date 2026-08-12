// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { defineResource } from '../ecs/resource';
import { Assets as AssetsClass } from './Assets';
import { HttpBackend } from './Backend';
import { transcoderFromModule, type BasisWasmModule } from './basisTranscoder';
import { AssetRefCounter } from './AssetRefCounter';
import { Audio, type AudioAPI } from '../audio/Audio';
import { SpriteAnimation, type SpriteAnimationAPI } from '../animation/SpriteAnimator';
import { Localization, type LocalizationAPI } from '../i18n/Localization';
import { log } from '../util/logger';

/**
 * The asset loader a system receives from `Res(Assets)`.
 *
 * `@beta`, and the evidence says so: of its members the certified corpus calls
 * four, and a third of the rest is the host wiring a runtime in — resolvers,
 * registries, the manifest, device-loss recovery — which is the embedding contract
 * rather than anything a game writes.
 *
 * @beta
 */
export type AssetsData = AssetsClass;

/**
 * The asset loader, as a resource. Rarely the door a game uses: scenes preload
 * what they reference and components resolve their own assets, so this is for the
 * cases that outlive a scene — hot updates, groups loaded on demand.
 *
 * @beta
 */
export const Assets = defineResource<AssetsData>(
    null!,
    'Assets'
);

export class AssetPlugin implements Plugin {
    name = 'asset';

    build(app: App): void {
        const module = app.wasmModule;
        if (!module) {
            log.warn('asset', 'AssetPlugin: No WASM module available');
            return;
        }

        const assets = AssetsClass.create({
            backend: new HttpBackend({ baseUrl: '' }),
            module,
            getAudio: (): AudioAPI | null =>
                app.hasResource(Audio) ? app.getResource(Audio) : null,
            getSpriteAnimation: (): SpriteAnimationAPI | null =>
                app.hasResource(SpriteAnimation) ? app.getResource(SpriteAnimation) : null,
            getLocalization: (): LocalizationAPI | null =>
                app.hasResource(Localization) ? app.getResource(Localization) : null,
        });

        // Lazily acquire the Basis transcoder for KTX2 textures the same way
        // physics/spine acquire their modules — only when a compressed texture is
        // actually loaded. The closure defers to app.sideModules,
        // which the realm sets before any asset load.
        assets.getTextureLoader().setTranscoderProvider(async () => {
            const host = app.sideModules;
            if (!host) return null;
            const mod = await host.acquire('basis');
            return mod ? transcoderFromModule(mod as unknown as BasisWasmModule) : null;
        });

        // Install the ref counter so resolveSceneAssetPaths records who
        // uses what, and wire it to world despawns so entries don't
        // outlive their entities. Tools / debug UI read it via
        // `assets.getRefCounter()`.
        const counter = new AssetRefCounter();
        assets.setRefCounter(counter);
        app.world.onDespawn((entity) => counter.removeAllRefsForEntity(entity));

        app.insertResource(Assets, assets);
    }
}

export const assetPlugin = new AssetPlugin();
