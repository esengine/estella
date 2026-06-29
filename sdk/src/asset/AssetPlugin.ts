// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app';
import { defineResource } from '../resource';
import { Assets as AssetsClass } from './Assets';
import { HttpBackend } from './Backend';
import { transcoderFromModule, type BasisWasmModule } from './basisTranscoder';
import { initBuiltinAssetFields } from './AssetFieldRegistry';
import { AssetRefCounter } from './AssetRefCounter';
import { Audio, type AudioAPI } from '../audio/Audio';
import { SpriteAnimation, type SpriteAnimationApi } from '../animation/SpriteAnimator';
import { log } from '../logger';

export type AssetsData = AssetsClass;

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

        initBuiltinAssetFields();

        const assets = AssetsClass.create({
            backend: new HttpBackend({ baseUrl: '' }),
            module,
            getAudio: (): AudioAPI | null =>
                app.hasResource(Audio) ? app.getResource(Audio) : null,
            getSpriteAnimation: (): SpriteAnimationApi | null =>
                app.hasResource(SpriteAnimation) ? app.getResource(SpriteAnimation) : null,
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
