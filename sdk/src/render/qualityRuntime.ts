// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

import type { App } from '../app/app';
import { defineResource } from '../ecs/resource';
import { engineApi } from '../ecs/bridge/engineApi';
import { getPlatform, platformNow, platformOnAppHide, platformOnAppShow } from '../platform';
import { QualityController, type QualityConfig, type QualityProfile } from './quality';
import { getDeviceIdentity } from './renderer';
import { decidePower } from './power';
import { NO_POWER_STATE } from '../device/types';

/** @experimental */
export const Quality = defineResource<QualityController | null>(null, 'Quality');

export function installQuality(app: App, config: QualityConfig, authoredMsaa: number): void {
    const platform = getPlatform();
    const info = platform.deviceQualityInfo?.();
    const gpu = getDeviceIdentity(app.wasmModule)?.renderer || info?.gpu;
    const quality = new QualityController(config, {
        model: platform.deviceName?.(), ...info, gpu,
    });
    app.insertResource(Quality, quality);
    // A delivery choice and not a level of quality: it holds whatever the level, and whether the quality system is on at all.
    engineApi(app)?.renderer_setAsyncShaderCompile?.(config.asyncShaderCompile === true);
    let applied: Readonly<QualityProfile> | null = null;
    let enabled: boolean | null = null;
    let last = 0;
    let hidden = false;
    const hide = platformOnAppHide(() => { hidden = true; last = 0; });
    const show = platformOnAppShow(() => { hidden = false; last = 0; });
    const apply = (): void => {
        if (applied === quality.profile && enabled === quality.enabled) return;
        applied = quality.profile;
        enabled = quality.enabled;
        const api = engineApi(app);
        // Temporal anti-aliasing is the one smoothing there is: a multisampled target under it would be paid for and resolved for nothing.
        api?.postprocess_setMsaaSamples?.(enabled ? (applied.antialiasing === 'temporal' ? 1 : applied.msaaSamples) : authoredMsaa);
        const budgets = api?.renderer_setQualityBudgets;
        quality.setLimitation('quality-budgets-unavailable', enabled && !budgets);
        budgets?.(enabled ? applied.shadowAtlasSize : 2048,
            enabled ? applied.shadowCellSize : 512, enabled ? applied.shadowCascades : 4,
            enabled ? applied.particleLimit : 0xffffffff);
        quality.setLimitation('shadow-distance-unavailable',
            enabled && applied.shadowDistance > 0 && !api?.renderer_setShadowDistance);
        api?.renderer_setShadowDistance?.(enabled ? applied.shadowDistance : 0);
        // With no quality policy a soft 2D shadow is drawn with the sixteen samples it always was.
        api?.renderer_setShadow2DSoftSamples?.(enabled ? applied.shadowSoftSamples : 16);
        api?.renderer_setDepthPrepass?.(enabled && applied.depthPrepass);
        api?.renderer_setPlanarReflectionQuality?.(enabled ? applied.planarReflectionScale : 0.5,
            enabled ? applied.planarReflectionMaxSize : 1024,
            enabled ? applied.planarReflectionUpdatesPerSecond : 0);
    };
    app.pipeline?.setQuality(quality, apply);
    apply();

    // The device's battery and heat, looked at every few seconds and only when a policy names them: saving lowers the frame cap and the level, and
    // takes only its own lowering off. A cap the game set lower than the saver's is left alone, and one it changes meanwhile is the game's.
    const policy = config.power;
    let powerTimer: ReturnType<typeof setInterval> | null = null;
    if (policy) {
        let capped: { from: number; to: number } | null = null;
        const check = (): void => {
            const state = platform.device?.().power?.() ?? NO_POWER_STATE;
            const decision = decidePower(state, policy);
            quality.setCeiling(decision.ceiling);
            quality.setLimitation('power-saver', decision.saving);
            const now = app.getTargetFrameRate();
            if (decision.saving && decision.fps > 0) {
                // Lowered only: an uncapped loop (0) or a higher cap goes down to the saver's; a lower one stays.
                if (capped === null && (now === 0 || now > decision.fps)) { capped = { from: now, to: decision.fps }; app.setTargetFrameRate(decision.fps); }
                else if (capped !== null && capped.to !== decision.fps && now === capped.to) { capped.to = decision.fps; app.setTargetFrameRate(decision.fps); }
            } else if (capped !== null) {
                // Back to what it was, unless the game has set its own cap since.
                if (now === capped.to) app.setTargetFrameRate(capped.from);
                capped = null;
            }
        };
        check();
        powerTimer = setInterval(check, 5000);
    }
    const stop = app.onFrameEnd(() => {
        const now = platformNow();
        if (!hidden && !app.isPaused() && last > 0) quality.sample(now - last,
            engineApi(app)?.renderer_getGpuTimeMs?.() ?? -1);
        last = hidden || app.isPaused() ? 0 : now;
    });
    app.addPlugin({ name: 'quality', build() {}, cleanup() { stop(); hide(); show(); if (powerTimer !== null) clearInterval(powerTimer); } });
}
