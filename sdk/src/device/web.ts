// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { DeviceEvents, emptyMotion } from './core';
import { DEVICE_OK, DEVICE_UNAVAILABLE, deviceFailure, type DeviceBackend, type DeviceCapabilities, type DeviceResult,
    type MotionOptions, type PowerState, type VibrationOptions } from './types';

type PermissionEvent = { requestPermission?: () => Promise<string> };
type WakeSentinel = { released: boolean; release(): Promise<void>; addEventListener(type: string, listener: () => void): void };
type BatteryManager = { level: number; charging: boolean; addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void };
type PressureRecord = { state: PowerState['thermal'] };
type PressureObserverLike = { observe(source: 'cpu'): Promise<void>; disconnect(): void };
type WakeNavigator = Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> }; getBattery?: () => Promise<BatteryManager> };

export class WebDevice implements DeviceBackend {
    private readonly events = new DeviceEvents();
    private options: MotionOptions | null = null;
    private motionEpoch = 0;
    private wakeEpoch = 0;
    private wakeWanted = false;
    private wake: WakeSentinel | null = null;
    private disposed = false;
    private lastMotion = 0;
    private battery: BatteryManager | null = null;
    private pressure: PowerState['thermal'] = null;
    private pressureObserver: PressureObserverLike | null = null;
    private powerStarted = false;
    constructor(private readonly win: Window = window, private readonly doc: Document = document,
        private readonly nav: WakeNavigator = navigator as WakeNavigator) {
        doc.addEventListener('visibilitychange', this.visibility);
        win.addEventListener('pagehide', this.hide);
        win.addEventListener('pageshow', this.visibility);
        doc.addEventListener('fullscreenchange', this.screenChanged);
        doc.addEventListener('pointerlockchange', this.screenChanged);
    }
    capabilities(): DeviceCapabilities {
        const scope = this.win as Window & { DeviceMotionEvent?: PermissionEvent; DeviceOrientationEvent?: PermissionEvent };
        return { accelerometer: !!scope.DeviceMotionEvent, gyroscope: !!scope.DeviceMotionEvent,
            orientation: !!scope.DeviceOrientationEvent, vibration: typeof this.nav.vibrate === 'function',
            vibrationIntensity: false, keepScreenOn: !!this.nav.wakeLock,
            fullscreen: typeof this.doc.documentElement?.requestFullscreen === 'function',
            pointerLock: typeof this.doc.documentElement?.requestPointerLock === 'function' };
    }
    state() { return { ...this.events.state }; }
    /** What the browser has said so far: the battery (Chromium) and the processor's pressure (Chromium). Both arrive a moment after the first call. */
    power(): PowerState {
        this.startPower();
        const battery = this.battery;
        return { level: battery ? battery.level : null, charging: battery ? battery.charging : null, thermal: this.pressure };
    }
    private startPower(): void {
        if (this.powerStarted || this.disposed) return;
        this.powerStarted = true;
        try { void this.nav.getBattery?.().then((battery) => { if (!this.disposed) this.battery = battery; }, () => undefined); } catch { /* no battery to read */ }
        try {
            const Observer = (this.win as unknown as { PressureObserver?: new (callback: (records: PressureRecord[]) => void) => PressureObserverLike }).PressureObserver;
            if (Observer) {
                const observer = new Observer((records) => { const last = records[records.length - 1]; if (last) this.pressure = last.state; });
                this.pressureObserver = observer;
                void observer.observe('cpu').catch(() => undefined);
            }
        } catch { /* the page may not be allowed to observe pressure */ }
    }
    onMotion(handler: Parameters<DeviceBackend['onMotion']>[0]) { return this.events.onMotion(handler); }
    onStateChange(handler: Parameters<DeviceBackend['onStateChange']>[0]) { return this.events.onStateChange(handler); }
    async startMotion(options: MotionOptions = {}): Promise<DeviceResult> {
        const chosen = { accelerometer: true, gyroscope: true, orientation: false, rate: 'game' as const, ...options };
        const caps = this.capabilities();
        if (this.disposed || (!chosen.accelerometer && !chosen.gyroscope && !chosen.orientation)
            || (chosen.accelerometer && !caps.accelerometer) || (chosen.gyroscope && !caps.gyroscope)
            || (chosen.orientation && !caps.orientation)) return DEVICE_UNAVAILABLE;
        const epoch = ++this.motionEpoch;
        const scope = this.win as Window & { DeviceMotionEvent?: PermissionEvent; DeviceOrientationEvent?: PermissionEvent };
        try {
            // Invoke both synchronously: iOS requires the original player gesture.
            const requests: Promise<string>[] = [];
            if (chosen.accelerometer || chosen.gyroscope) {
                const event = scope.DeviceMotionEvent;
                if (event?.requestPermission) requests.push(event.requestPermission());
            }
            if (chosen.orientation) {
                const event = scope.DeviceOrientationEvent;
                if (event?.requestPermission) requests.push(event.requestPermission());
            }
            const permissions = await Promise.all(requests);
            if (epoch !== this.motionEpoch || this.disposed) return { status: 'failed', reason: 'Motion request cancelled' };
            if (permissions.some(p => p !== 'granted')) return { status: 'denied' };
            this.unbindMotion(); this.events.reset(); this.lastMotion = 0; this.options = chosen;
            if (!this.doc.hidden) this.bindMotion();
            return DEVICE_OK;
        } catch (error) { return deviceFailure(error); }
    }
    async stopMotion(): Promise<DeviceResult> {
        ++this.motionEpoch; this.options = null; this.unbindMotion(); this.events.reset(); return DEVICE_OK;
    }
    async vibrate(options: VibrationOptions = {}): Promise<DeviceResult> {
        if (this.disposed || !this.capabilities().vibration) return DEVICE_UNAVAILABLE;
        try { return this.nav.vibrate(options.duration === 'long' ? 400 : 15) ? DEVICE_OK : { status: 'denied' }; }
        catch (error) { return deviceFailure(error); }
    }
    async keepScreenOn(enabled: boolean): Promise<DeviceResult> {
        if (this.disposed || !this.nav.wakeLock) return DEVICE_UNAVAILABLE;
        this.wakeWanted = enabled;
        const epoch = ++this.wakeEpoch;
        if (!enabled) { await this.releaseWake(); return DEVICE_OK; }
        if (this.doc.hidden) return { status: 'denied', reason: 'Document is hidden' };
        if (this.wake && !this.wake.released) return DEVICE_OK;
        try {
            const sentinel = await this.nav.wakeLock.request('screen');
            if (epoch !== this.wakeEpoch || !this.wakeWanted || this.doc.hidden || this.disposed) {
                await sentinel.release(); return { status: 'failed', reason: 'Screen wake request cancelled' };
            }
            this.wake = sentinel; this.events.update({ screenOn: !sentinel.released });
            sentinel.addEventListener('release', () => {
                if (this.wake !== sentinel) return;
                this.wake = null; this.events.update({ screenOn: false });
            });
            return DEVICE_OK;
        } catch (error) { return deviceFailure(error); }
    }
    async fullscreen(enabled: boolean, target?: unknown): Promise<DeviceResult> {
        const element = (target ?? this.doc.documentElement) as Element;
        if (this.disposed || (enabled ? typeof element?.requestFullscreen !== 'function' : typeof this.doc.exitFullscreen !== 'function')) return DEVICE_UNAVAILABLE;
        try {
            if (enabled) await element.requestFullscreen();
            else if (this.doc.fullscreenElement) await this.doc.exitFullscreen();
            this.screenChanged(); return DEVICE_OK;
        } catch (error) { return deviceFailure(error); }
    }
    pointerLock(enabled: boolean, target?: unknown): Promise<DeviceResult> {
        const element = (target ?? this.doc.documentElement) as Element;
        if (this.disposed || (enabled ? typeof element?.requestPointerLock !== 'function' : typeof this.doc.exitPointerLock !== 'function')) return Promise.resolve(DEVICE_UNAVAILABLE);
        if ((enabled && this.doc.pointerLockElement === element) || (!enabled && !this.doc.pointerLockElement)) return Promise.resolve(DEVICE_OK);
        return new Promise(resolve => {
            let done = false;
            const finish = (result: DeviceResult) => {
                if (done) return; done = true; clearTimeout(timeout);
                this.doc.removeEventListener('pointerlockchange', changed);
                this.doc.removeEventListener('pointerlockerror', denied);
                this.screenChanged(); resolve(result);
            };
            const changed = () => finish((enabled ? this.doc.pointerLockElement === element : !this.doc.pointerLockElement)
                ? DEVICE_OK : { status: 'failed', reason: 'Pointer lock request interrupted' });
            const denied = () => finish({ status: 'denied', reason: 'Pointer lock requires a player gesture' });
            const timeout = setTimeout(() => finish({ status: 'failed', reason: 'Pointer lock request timed out' }), 2000);
            this.doc.addEventListener('pointerlockchange', changed);
            this.doc.addEventListener('pointerlockerror', denied);
            try {
                if (enabled) {
                    const request = element.requestPointerLock() as unknown as Promise<void> | undefined;
                    request?.catch(error => finish(deviceFailure(error)));
                } else this.doc.exitPointerLock();
            } catch (error) { finish(deviceFailure(error)); }
        });
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; void this.stopMotion(); this.wakeWanted = false; ++this.wakeEpoch; void this.releaseWake();
        this.doc.removeEventListener('visibilitychange', this.visibility);
        this.win.removeEventListener('pagehide', this.hide); this.win.removeEventListener('pageshow', this.visibility);
        this.doc.removeEventListener('fullscreenchange', this.screenChanged);
        this.doc.removeEventListener('pointerlockchange', this.screenChanged); this.events.dispose();
        this.pressureObserver?.disconnect(); this.pressureObserver = null; this.battery = null;
    }
    private bindMotion(): void {
        if (!this.options || this.disposed) return;
        if (this.options.accelerometer || this.options.gyroscope) this.win.addEventListener('devicemotion', this.motion);
        if (this.options.orientation) this.win.addEventListener('deviceorientation', this.orientation);
        this.events.update({ motionActive: true });
    }
    private unbindMotion(): void {
        this.win.removeEventListener('devicemotion', this.motion); this.win.removeEventListener('deviceorientation', this.orientation);
        this.events.update({ motionActive: false });
    }
    private motion = (event: DeviceMotionEvent): void => {
        const timestamp = event.timeStamp;
        const interval = this.options?.rate === 'normal' ? 200 : this.options?.rate === 'ui' ? 60 : 16;
        if (this.lastMotion && timestamp - this.lastMotion < interval) return;
        this.lastMotion = timestamp;
        const vector = (v: DeviceMotionEventAcceleration | null) => v && v.x !== null && v.y !== null && v.z !== null
            ? { x: v.x, y: v.y, z: v.z } : null;
        const r = event.rotationRate; const rad = Math.PI / 180;
        this.events.emit({ ...emptyMotion(), timestamp,
            acceleration: this.options?.accelerometer ? vector(event.acceleration) : null,
            accelerationIncludingGravity: this.options?.accelerometer ? vector(event.accelerationIncludingGravity) : null,
            gyroscope: this.options?.gyroscope && r && r.alpha !== null && r.beta !== null && r.gamma !== null
                ? { x: r.beta * rad, y: r.gamma * rad, z: r.alpha * rad } : null });
    };
    private orientation = (event: DeviceOrientationEvent): void => {
        if (event.alpha === null || event.beta === null || event.gamma === null) return;
        this.events.emit({ ...emptyMotion(), timestamp: event.timeStamp,
            orientation: { x: event.beta, y: event.gamma, z: event.alpha } });
    };
    private screenChanged = (): void => { this.events.update({ fullscreen: !!this.doc.fullscreenElement, pointerLocked: !!this.doc.pointerLockElement }); };
    private hide = (): void => { this.unbindMotion(); this.events.reset(); ++this.wakeEpoch; void this.releaseWake(); };
    private visibility = (): void => {
        if (this.doc.hidden) this.hide();
        else { this.bindMotion(); if (this.wakeWanted) void this.keepScreenOn(true); }
    };
    private async releaseWake(): Promise<void> {
        const sentinel = this.wake; this.wake = null; this.events.update({ screenOn: false });
        try { await sentinel?.release(); } catch { /* platform already released it */ }
    }
}
