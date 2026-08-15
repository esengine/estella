// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { defineResource, Time } from '../ecs/resource';
import { Schedule, defineSystem } from '../ecs/system';
import { DeviceStatus, getDeviceStatus } from '../render/renderer';
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
        this.driveDeviceRecovery_(app, assets);
    }

    /**
     * Recovers the renderer after a device loss, which nothing did: the path
     * existed end to end with no caller but a test probe, so a shipped game that
     * lost its GPU stayed lost. Timed off UNSCALED delta — a paused game still
     * has to come back — and backed off, since each attempt re-fetches content.
     */
    private driveDeviceRecovery_(app: App, assets: AssetsClass): void {
        let inFlight = false;
        let waited = 0;
        let backoff = 0;
        let downtime = 0;

        app.addSystemToSchedule(Schedule.First, defineSystem([], () => {
            const status = getDeviceStatus();
            if (status === DeviceStatus.Live || status === DeviceStatus.Dead) {
                backoff = 0;
                waited = 0;
                downtime = 0;
                return;
            }
            const dt = app.getResource(Time)?.unscaledDelta ?? 0;
            downtime += dt;
            if (inFlight) return;
            waited += dt;
            if (waited < backoff) return;

            waited = 0;
            inFlight = true;
            const lostFor = downtime;
            void assets.recoverFromDeviceLoss()
                .then((whole) => {
                    if (whole) {
                        log.info('asset', `Device recovered after ${lostFor.toFixed(1)}s`);
                        backoff = 0;
                        return;
                    }
                    backoff = Math.min(backoff ? backoff * 2 : RECOVERY_RETRY_S, RECOVERY_RETRY_MAX_S);
                })
                .catch((e) => {
                    log.warn('asset', 'Device recovery threw; will retry', e);
                    backoff = Math.min(backoff ? backoff * 2 : RECOVERY_RETRY_S, RECOVERY_RETRY_MAX_S);
                })
                .finally(() => { inFlight = false; });
        }));
    }
}

/** First wait after a recovery attempt comes back incomplete, in seconds. */
const RECOVERY_RETRY_S = 0.25;
/** Ceiling for that wait: a context can take a while, but not minutes. */
const RECOVERY_RETRY_MAX_S = 5;

export const assetPlugin = new AssetPlugin();
