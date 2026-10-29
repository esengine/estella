// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Vec3 } from '../types';

export type DeviceRequestStatus = 'ok' | 'unavailable' | 'denied' | 'failed';
export interface DeviceResult { status: DeviceRequestStatus; reason?: string }
export interface DeviceCapabilities {
    accelerometer: boolean;
    gyroscope: boolean;
    orientation: boolean;
    vibration: boolean;
    vibrationIntensity: boolean;
    keepScreenOn: boolean;
    fullscreen: boolean;
    pointerLock: boolean;
}
export type MotionRate = 'normal' | 'ui' | 'game';
export interface MotionOptions {
    accelerometer?: boolean;
    gyroscope?: boolean;
    orientation?: boolean;
    rate?: MotionRate;
}
/** SI units: acceleration/gravity in m/s², angular velocity in rad/s.
 * Orientation angles are degrees; unavailable channels are null. */
export interface MotionSample {
    timestamp: number;
    acceleration: Vec3 | null;
    accelerationIncludingGravity: Vec3 | null;
    gyroscope: Vec3 | null;
    gravity: Vec3 | null;
    orientation: Vec3 | null;
}
export type VibrationIntensity = 'light' | 'medium' | 'heavy';
export interface VibrationOptions { duration?: 'short' | 'long'; intensity?: VibrationIntensity }
export interface DeviceState { fullscreen: boolean; pointerLocked: boolean; screenOn: boolean; motionActive: boolean }
/** How much the device has left to give: the battery and how hot it runs. A null is a thing this platform does not say, which is not the same as nothing being wrong. */
export interface PowerState {
    /** The battery's charge, 0 to 1. */
    level: number | null;
    charging: boolean | null;
    /** Thermal pressure on the processor, as the platform reports it. */
    thermal: 'nominal' | 'fair' | 'serious' | 'critical' | null;
}
export const NO_POWER_STATE: PowerState = { level: null, charging: null, thermal: null };
export interface DeviceBackend {
    /** The device's battery and thermal state, from what the platform has told it so far. Absent on a backend that cannot know. */
    power?(): PowerState;
    capabilities(): DeviceCapabilities;
    state(): DeviceState;
    startMotion(options?: MotionOptions): Promise<DeviceResult>;
    stopMotion(): Promise<DeviceResult>;
    onMotion(handler: (sample: MotionSample) => void): () => void;
    onStateChange(handler: (state: DeviceState) => void): () => void;
    vibrate(options?: VibrationOptions): Promise<DeviceResult>;
    keepScreenOn(enabled: boolean): Promise<DeviceResult>;
    fullscreen(enabled: boolean, target?: unknown): Promise<DeviceResult>;
    pointerLock(enabled: boolean, target?: unknown): Promise<DeviceResult>;
    dispose(): void;
}
export const DEVICE_OK: DeviceResult = { status: 'ok' };
export const DEVICE_UNAVAILABLE: DeviceResult = { status: 'unavailable' };
export const NO_DEVICE_CAPABILITIES: DeviceCapabilities = {
    accelerometer: false, gyroscope: false, orientation: false,
    vibration: false, vibrationIntensity: false, keepScreenOn: false,
    fullscreen: false, pointerLock: false,
};
export function deviceFailure(error: unknown): DeviceResult {
    const name = (error as { name?: string })?.name;
    return { status: name === 'NotSupportedError' ? 'unavailable'
        : name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed',
        reason: error instanceof Error ? error.message : String(error) };
}
