// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { defineResource, Time } from '../ecs/resource';
import { Schedule, defineSystem } from '../ecs/system';
import { DeviceStatus, getDeviceStatus } from '../render/renderer';
import { Assets as AssetsClass } from './Assets';
import { HttpBackend } from './Backend';
import { basisTranscoderFor } from './basisWorkers';
import { bindAppAssetReferences } from './assetReferenceTracking';
import { Audio, type AudioAPI } from '../audio/Audio';
import { SpriteAnimation, type SpriteAnimationAPI } from '../animation/SpriteAnimator';
import { Localization, type LocalizationAPI } from '../i18n/Localization';
import { log } from '../util/logger';
import { disposeAll } from '../util/disposeAll';

interface AssetPluginState {
    created: AssetsClass;
    current: () => AssetsClass | null;
    released: boolean;
}

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

const runtimeOwners = new WeakMap<App, () => void>();
const runtimeReleases = new WeakMap<AssetsClass, (() => void) | null>();

/** @internal Retire scene assets while their module host and renderer are still live. */
export function releaseRuntimeAssets(app: App): void {
    runtimeOwners.get(app)?.();
}

/** @internal Scene loaders belong to the App even when it uses no default asset plugin. */
export function installRuntimeAssets(app: App, assets: AssetsClass, onRelease: () => void): void {
    releaseRuntimeAssets(app);
    const release = () => {
        if (runtimeOwners.get(app) !== release) return;
        runtimeOwners.delete(app);
        runtimeReleases.set(assets, null);
        try { onRelease(); }
        finally { assets.releaseAll(); }
    };
    runtimeOwners.set(app, release);
    runtimeReleases.set(assets, release);
    installAssets(app, assets);
}

export function installAssets(app: App, assets: AssetsClass): void {
    bindAppAssetReferences(app, assets,
        () => app.hasResource(Assets) ? app.getResource(Assets) : null);
    app.insertResource(Assets, assets);
}

export class AssetPlugin implements Plugin {
    name = 'asset';
    private readonly states_ = new WeakMap<App, AssetPluginState>();
    private latestState_: AssetPluginState | null = null;

    build(app: App): void {
        this.cleanup(app);
        const module = app.wasmModule;

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
        assets.getTextureLoader().setTranscoderProvider(() => basisTranscoderFor(app.sideModules));

        // Install the ref counter so scene spawning records live World IDs,
        // and wire it to world despawns so entries don't
        // outlive their entities. Tools / debug UI read it via
        // `assets.getRefCounter()`.
        installAssets(app, assets);
        const state: AssetPluginState = { created: assets,
            current: () => app.hasResource(Assets) ? app.getResource(Assets) : null, released: false };
        this.states_.set(app, state);
        this.latestState_ = state;
        if (module) this.driveDeviceRecovery_(app, state);
    }

    /** Release both the default loader and any runtime replacement owned by this App. */
    cleanup(app?: App): void {
        const state = app ? this.states_.get(app) : this.latestState_;
        if (!state || state.released) return;
        state.released = true;
        if (app) this.states_.delete(app);
        if (state === this.latestState_) this.latestState_ = null;
        const current = state.current();
        disposeAll(current && current !== state.created ? [state.created, current] : [state.created], assets => {
            const release = runtimeReleases.get(assets);
            if (release === undefined) assets.releaseAll();
            else release?.();
        });
    }

    /**
     * Recovers the renderer after a device loss, which nothing did: the path
     * existed end to end with no caller but a test probe, so a shipped game that
     * lost its GPU stayed lost. Timed off UNSCALED delta — a paused game still
     * has to come back — and backed off, since each attempt re-fetches content.
     */
    private driveDeviceRecovery_(app: App, state: AssetPluginState): void {
        let inFlight = false;
        let waited = 0;
        let backoff = 0;
        let downtime = 0;

        app.addSystemToSchedule(Schedule.First, defineSystem([], () => {
            if (state.released) return;
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
            // A runtime replaces the default HTTP-backed resource with its own
            // decoder. Never recover the instance captured during plugin build.
            const recoverCurrent = async (): Promise<boolean> => {
                let assets = app.hasResource(Assets) ? app.getResource(Assets) : null;
                while (assets && !state.released) {
                    const whole = await assets.recoverFromDeviceLoss();
                    if (state.released) return false;
                    const current = app.hasResource(Assets) ? app.getResource(Assets) : null;
                    if (current === assets) return whole;
                    assets = current;
                }
                return false;
            };
            void recoverCurrent()
                .then((whole) => {
                    if (state.released) return;
                    if (whole) {
                        log.info('asset', `Device recovered after ${lostFor.toFixed(1)}s`);
                        backoff = 0;
                        return;
                    }
                    backoff = Math.min(backoff ? backoff * 2 : RECOVERY_RETRY_S, RECOVERY_RETRY_MAX_S);
                })
                .catch((e) => {
                    if (state.released) return;
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
