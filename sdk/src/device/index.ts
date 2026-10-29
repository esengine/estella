// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { getPlatform, isPlatformInitialized } from '../platform/base';
import { unavailableDevice } from './core';
import { NO_POWER_STATE, deviceFailure, type DeviceBackend, type PowerState, type DeviceResult, type MotionOptions, type MotionSample, type DeviceState, type VibrationOptions } from './types';
export type * from './types';
const unavailable = unavailableDevice();
function backend(): DeviceBackend {
    return isPlatformInitialized() ? getPlatform().device?.() ?? unavailable : unavailable;
}
function invoke(call: (device: DeviceBackend) => Promise<DeviceResult>): Promise<DeviceResult> {
    try { return Promise.resolve(call(backend())).catch(deviceFailure); } catch (error) { return Promise.resolve(deviceFailure(error)); }
}
/** Requests requiring a player gesture must be called from the host event itself. */
export const Device = {
    capabilities: () => backend().capabilities(),
    state: () => backend().state(),
    /** The battery and the processor's heat as far as the platform has said (a null is a thing it does not say). */
    power: (): PowerState => backend().power?.() ?? NO_POWER_STATE,
    motion: {
        start: (options?: MotionOptions) => invoke(d => d.startMotion(options)),
        stop: () => invoke(d => d.stopMotion()),
        onChange: (handler: (sample: MotionSample) => void) => backend().onMotion(handler),
    },
    vibrate: (options?: VibrationOptions) => invoke(d => d.vibrate(options)),
    keepScreenOn: (enabled: boolean) => invoke(d => d.keepScreenOn(enabled)),
    fullscreen: (enabled: boolean, target?: unknown) => invoke(d => d.fullscreen(enabled, target)),
    pointerLock: (enabled: boolean, target?: unknown) => invoke(d => d.pointerLock(enabled, target)),
    onChange: (handler: (state: DeviceState) => void) => backend().onStateChange(handler),
    dispose: () => backend().dispose(),
};
