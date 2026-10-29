// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { DeviceEvents, emptyMotion } from './core';
import { DEVICE_OK, DEVICE_UNAVAILABLE, NO_DEVICE_CAPABILITIES, NO_POWER_STATE, deviceFailure,
    type DeviceBackend, type DeviceResult, type MotionOptions, type PowerState, type VibrationOptions } from './types';
import type { Vec3 } from '../types';

interface Callbacks { success?(): void; fail?(error: { errMsg?: string }): void }
interface SensorOptions extends Callbacks { interval?: 'normal' | 'ui' | 'game' }
export interface MiniGameDeviceHost {
    startAccelerometer?(options: SensorOptions): void;
    stopAccelerometer?(options: Callbacks): void;
    onAccelerometerChange?(handler: (value: Vec3) => void): void;
    offAccelerometerChange?(handler: (value: Vec3) => void): void;
    startGyroscope?(options: SensorOptions): void;
    stopGyroscope?(options: Callbacks): void;
    onGyroscopeChange?(handler: (value: Vec3) => void): void;
    offGyroscopeChange?(handler: (value: Vec3) => void): void;
    vibrateShort?(options: Callbacks & { type: 'light' | 'medium' | 'heavy' }): void;
    vibrateLong?(options: Callbacks): void;
    setKeepScreenOn?(options: Callbacks & { keepScreenOn: boolean }): void;
    /** The battery as the mini-game platform reports it: level 0 to 100. */
    getBatteryInfoSync?(): { level: number; isCharging: boolean };
    onHide?(handler: () => void): void;
    offHide?(handler: () => void): void;
    onShow?(handler: () => void): void;
    offShow?(handler: () => void): void;
}
export class MiniGameDevice implements DeviceBackend {
    private readonly events = new DeviceEvents();
    private options: MotionOptions | null = null;
    private epoch = 0;
    private hidden = false;
    private disposed = false;
    private screenWanted = false;
    private screenEpoch = 0;
    private tail: Promise<unknown> = Promise.resolve();
    constructor(private readonly host: MiniGameDeviceHost, private readonly now: () => number = () => Date.now()) {
        host.onHide?.(this.hide); host.onShow?.(this.show);
    }
    power(): PowerState {
        try {
            const info = this.host.getBatteryInfoSync?.();
            return info ? { level: Math.min(Math.max(info.level / 100, 0), 1), charging: !!info.isCharging, thermal: null } : NO_POWER_STATE;
        } catch { return NO_POWER_STATE; }
    }
    capabilities() {
        const h = this.host;
        return { ...NO_DEVICE_CAPABILITIES,
            accelerometer: !!(h.startAccelerometer && h.stopAccelerometer && h.onAccelerometerChange && h.offAccelerometerChange),
            gyroscope: !!(h.startGyroscope && h.stopGyroscope && h.onGyroscopeChange && h.offGyroscopeChange),
            vibration: !!(h.vibrateShort || h.vibrateLong), vibrationIntensity: !!h.vibrateShort,
            keepScreenOn: !!h.setKeepScreenOn };
    }
    state() { return { ...this.events.state }; }
    onMotion(handler: Parameters<DeviceBackend['onMotion']>[0]) { return this.events.onMotion(handler); }
    onStateChange(handler: Parameters<DeviceBackend['onStateChange']>[0]) { return this.events.onStateChange(handler); }
    startMotion(options: MotionOptions = {}): Promise<DeviceResult> {
        const selected = { accelerometer: true, gyroscope: true, orientation: false, rate: 'game' as const, ...options };
        const caps = this.capabilities();
        if (this.disposed || selected.orientation || (!selected.accelerometer && !selected.gyroscope)
            || (selected.accelerometer && !caps.accelerometer) || (selected.gyroscope && !caps.gyroscope)) return Promise.resolve(DEVICE_UNAVAILABLE);
        this.options = selected;
        const epoch = ++this.epoch;
        return this.enqueue(async () => {
            await this.stopSensors();
            if (epoch !== this.epoch || this.hidden || this.disposed) return { status: 'failed', reason: 'Motion request cancelled' };
            this.events.reset();
            try {
                if (selected.accelerometer) this.host.onAccelerometerChange!(this.acceleration);
                if (selected.gyroscope) this.host.onGyroscopeChange!(this.gyroscope);
                for (const key of [selected.accelerometer && 'startAccelerometer', selected.gyroscope && 'startGyroscope'] as const) {
                    if (!key) continue;
                    const result = await this.call(key, { interval: selected.rate });
                    if (result.status !== 'ok' || epoch !== this.epoch || this.hidden || this.disposed) {
                        await this.stopSensors();
                        return result.status !== 'ok' ? result : { status: 'failed', reason: 'Motion request cancelled' };
                    }
                }
                this.events.update({ motionActive: true }); return DEVICE_OK;
            } catch (error) { await this.stopSensors(); return deviceFailure(error); }
        });
    }
    stopMotion(): Promise<DeviceResult> {
        ++this.epoch; this.options = null; this.events.update({ motionActive: false });
        return this.enqueue(async () => { await this.stopSensors(); this.events.reset(); return DEVICE_OK; });
    }
    vibrate(options: VibrationOptions = {}): Promise<DeviceResult> {
        if (this.disposed || this.hidden) return Promise.resolve(DEVICE_UNAVAILABLE);
        return options.duration === 'long' ? this.call('vibrateLong') : this.call('vibrateShort', { type: options.intensity ?? 'medium' });
    }
    async keepScreenOn(enabled: boolean): Promise<DeviceResult> {
        if (this.disposed) return DEVICE_UNAVAILABLE;
        this.screenWanted = enabled;
        const epoch = ++this.screenEpoch;
        const result = await this.call('setKeepScreenOn', { keepScreenOn: enabled && !this.hidden });
        if (epoch !== this.screenEpoch) {
            await this.call('setKeepScreenOn', { keepScreenOn: this.screenWanted && !this.hidden && !this.disposed });
            return { status: 'failed', reason: 'Screen wake request superseded' };
        }
        if (result.status === 'ok') this.events.update({ screenOn: enabled && !this.hidden && !this.disposed });
        return result;
    }
    async fullscreen(_enabled: boolean, _target?: unknown): Promise<DeviceResult> { return DEVICE_UNAVAILABLE; }
    async pointerLock(_enabled: boolean, _target?: unknown): Promise<DeviceResult> { return DEVICE_UNAVAILABLE; }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; ++this.screenEpoch; void this.stopMotion(); this.screenWanted = false;
        void this.call('setKeepScreenOn', { keepScreenOn: false });
        this.host.offHide?.(this.hide); this.host.offShow?.(this.show); this.events.dispose();
    }
    private enqueue(task: () => Promise<DeviceResult>): Promise<DeviceResult> {
        const result = this.tail.then(task, task); this.tail = result; return result;
    }
    private call(key: 'startAccelerometer' | 'stopAccelerometer' | 'startGyroscope' | 'stopGyroscope'
        | 'vibrateShort' | 'vibrateLong' | 'setKeepScreenOn', options: Record<string, unknown> = {}): Promise<DeviceResult> {
        const method = this.host[key];
        if (!method) return Promise.resolve(DEVICE_UNAVAILABLE);
        return new Promise(resolve => {
            let done = false;
            const finish = (result: DeviceResult) => { if (done) return; done = true; clearTimeout(timeout); resolve(result); };
            const timeout = setTimeout(() => finish({ status: 'failed', reason: `${key} timed out` }), 3000);
            try {
                (method as (options: Record<string, unknown>) => void).call(this.host, { ...options,
                    success: () => finish(DEVICE_OK), fail: (error: { errMsg?: string }) => {
                        const reason = error?.errMsg ?? `${key} failed`;
                        finish({ status: /not support|unsupported|not available|unavailable|不支持/i.test(reason) ? 'unavailable'
                            : /auth|permission|denied/i.test(reason) ? 'denied' : 'failed', reason });
                    } });
            } catch (error) { finish(deviceFailure(error)); }
        });
    }
    private async stopSensors(): Promise<void> {
        this.events.update({ motionActive: false });
        this.host.offAccelerometerChange?.(this.acceleration); this.host.offGyroscopeChange?.(this.gyroscope);
        await Promise.all([this.call('stopAccelerometer'), this.call('stopGyroscope')]);
    }
    private acceleration = (value: Vec3): void => {
        if (![value.x, value.y, value.z].every(Number.isFinite)) return;
        this.events.emit({ ...emptyMotion(), timestamp: this.now(),
            accelerationIncludingGravity: { x: value.x * 9.80665, y: value.y * 9.80665, z: value.z * 9.80665 } });
    };
    private gyroscope = (value: Vec3): void => {
        if (![value.x, value.y, value.z].every(Number.isFinite)) return;
        this.events.emit({ ...emptyMotion(), timestamp: this.now(), gyroscope: { ...value } });
    };
    private hide = (): void => {
        this.hidden = true; ++this.epoch; ++this.screenEpoch; this.events.update({ motionActive: false, screenOn: false });
        void this.enqueue(async () => { await this.stopSensors(); this.events.reset(); return DEVICE_OK; });
        if (this.screenWanted) void this.call('setKeepScreenOn', { keepScreenOn: false });
    };
    private show = (): void => {
        if (this.disposed) return;
        this.hidden = false; if (this.options) void this.startMotion(this.options);
        if (this.screenWanted) void this.keepScreenOn(true);
    };
}
