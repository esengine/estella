// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Vec3 } from '../types';
import { DEVICE_UNAVAILABLE, NO_DEVICE_CAPABILITIES, type DeviceBackend, type DeviceState, type MotionSample } from './types';

export function emptyMotion(): MotionSample {
    return { timestamp: 0, acceleration: null, accelerationIncludingGravity: null,
        gyroscope: null, gravity: null, orientation: null };
}
/** Shared filtering and event isolation; platform adapters supply raw measurements. */
export class DeviceEvents {
    readonly state: DeviceState = { fullscreen: false, pointerLocked: false, screenOn: false, motionActive: false };
    private motionHandlers = new Set<(sample: MotionSample) => void>();
    private stateHandlers = new Set<(state: DeviceState) => void>();
    private gravity: Vec3 | null = null;
    private orientation: Vec3 | null = null;
    onMotion(handler: (sample: MotionSample) => void): () => void {
        this.motionHandlers.add(handler); return () => this.motionHandlers.delete(handler);
    }
    onStateChange(handler: (state: DeviceState) => void): () => void {
        this.stateHandlers.add(handler); return () => this.stateHandlers.delete(handler);
    }
    update(patch: Partial<DeviceState>): void {
        if (!Object.entries(patch).some(([k, v]) => this.state[k as keyof DeviceState] !== v)) return;
        Object.assign(this.state, patch);
        for (const handler of this.stateHandlers) {
            try {
                handler({ ...this.state });
            } catch { /* subscriber isolation */ }
        }
    }
    reset(): void { this.gravity = null; this.orientation = null; }
    emit(raw: MotionSample): void {
        if (!this.state.motionActive) return;
        if (raw.accelerationIncludingGravity) {
            const a = raw.accelerationIncludingGravity;
            const linear = raw.acceleration;
            const g = { x: a.x - (linear?.x ?? 0), y: a.y - (linear?.y ?? 0), z: a.z - (linear?.z ?? 0) };
            this.gravity = filter(this.gravity, g, false);
        }
        if (raw.orientation) this.orientation = filter(this.orientation, raw.orientation, true);
        const sample = { ...raw, gravity: this.gravity && { ...this.gravity }, orientation: this.orientation && { ...this.orientation } };
        for (const handler of this.motionHandlers) {
            try {
                handler(sample);
            } catch { /* subscriber isolation */ }
        }
    }
    dispose(): void { this.motionHandlers.clear(); this.stateHandlers.clear(); this.reset(); }
}
function filter(previous: Vec3 | null, next: Vec3, angles: boolean): Vec3 {
    if (!previous) return { ...next };
    const smooth = (a: number, b: number) => a + 0.15 * (angles ? ((b - a + 540) % 360) - 180 : b - a);
    return { x: smooth(previous.x, next.x), y: smooth(previous.y, next.y), z: smooth(previous.z, next.z) };
}
export function unavailableDevice(): DeviceBackend {
    const events = new DeviceEvents();
    const unavailable = async () => DEVICE_UNAVAILABLE;
    return { capabilities: () => ({ ...NO_DEVICE_CAPABILITIES }), state: () => ({ ...events.state }),
        startMotion: unavailable, stopMotion: unavailable, onMotion: h => events.onMotion(h),
        onStateChange: h => events.onStateChange(h), vibrate: unavailable,
        keepScreenOn: unavailable, fullscreen: unavailable, pointerLock: unavailable, dispose: () => events.dispose() };
}
