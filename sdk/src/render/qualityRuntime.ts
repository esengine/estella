// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

import type { App } from '../app/app';
import { defineResource } from '../ecs/resource';
import { engineApi } from '../ecs/bridge/engineApi';
import { getPlatform, platformNow, platformOnAppHide, platformOnAppShow } from '../platform';
import { QualityController, type QualityConfig, type QualityProfile } from './quality';
import { getDeviceIdentity } from './renderer';

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
        api?.postprocess_setMsaaSamples?.(enabled ? applied.msaaSamples : authoredMsaa);
        const budgets = api?.renderer_setQualityBudgets;
        quality.setLimitation('quality-budgets-unavailable', enabled && !budgets);
        budgets?.(enabled ? applied.shadowAtlasSize : 2048,
            enabled ? applied.shadowCellSize : 512, enabled ? applied.shadowCascades : 4,
            enabled ? applied.particleLimit : 0xffffffff);
        quality.setLimitation('shadow-distance-unavailable',
            enabled && applied.shadowDistance > 0 && !api?.renderer_setShadowDistance);
        api?.renderer_setShadowDistance?.(enabled ? applied.shadowDistance : 0);
    };
    app.pipeline?.setQuality(quality, apply);
    apply();
    const stop = app.onFrameEnd(() => {
        const now = platformNow();
        if (!hidden && !app.isPaused() && last > 0) quality.sample(now - last,
            engineApi(app)?.renderer_getGpuTimeMs?.() ?? -1);
        last = hidden || app.isPaused() ? 0 : now;
    });
    app.addPlugin({ name: 'quality', build() {}, cleanup() { stop(); hide(); show(); } });
}
