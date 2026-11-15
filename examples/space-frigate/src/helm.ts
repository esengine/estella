import { FIELD_DRIFT, ship } from './shipState';

export type Vec = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export const METRES = 1 / FIELD_DRIFT;
const TURN = 0.24;
const BANK = 0.5;
const GATES = ['KESTREL GATE', 'TARN RELAY', 'OSSA ANCHORAGE'] as const;
const REPEAT = 0.32;

export const ENGINE_ORDERS = [0, 0.25, 0.5, 0.75, 1] as const;
export const RUDDER_ORDERS = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1] as const;
export const ELEVATION_ORDERS = [-30, -15, 0, 15, 30] as const;
const GATE_REACH = 260;

export const mulQuat = (a: Quat, b: Quat): Quat => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

export function turnBy(q: Quat, v: Vec): Vec {
    const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
    return { x: v.x + q.w * tx + (q.y * tz - q.z * ty), y: v.y + q.w * ty + (q.z * tx - q.x * tz), z: v.z + q.w * tz + (q.x * ty - q.y * tx) };
}

export const turnBack = (q: Quat, v: Vec): Vec => turnBy({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);

const about = (axis: 'x' | 'y' | 'z', angle: number): Quat => ({ x: 0, y: 0, z: 0, w: Math.cos(angle / 2), [axis]: Math.sin(angle / 2) });
const facing = (yaw: number, pitch: number, roll = 0): Quat => mulQuat(mulQuat(about('y', yaw), about('x', -pitch)), about('z', roll));
const wrapped = (angle: number): number => angle - Math.round(angle / (Math.PI * 2)) * Math.PI * 2;

export type HelmMode = 'manual' | 'approach' | 'align';

export const helm = {
    yaw: 0, pitch: 0, roll: 0, yawRate: 0, pitchRate: 0,
    viewYaw: 0, viewPitch: 0,
    mode: 'manual' as HelmMode,
    order: 0.75,
    rudder: 0,
    elevation: 0,
    helmAngle: 0,
    attitude: facing(0, 0),
    level: facing(0, 0),
    frame: facing(0, 0),
    forward: { x: 0, y: 0, z: 1 } as Vec,
    gate: { x: 0, y: 14, z: 2600 } as Vec,
    gateName: GATES[0] as string,
    leg: 3,
    arrivals: 0,
    arrived: false,
    aim: null as Vec | null,
};

export interface HelmKeys { ahead: boolean; astern: boolean; port: boolean; starboard: boolean; climb: boolean; dive: boolean; steady: boolean; approach: boolean; align: boolean }

const held: Record<string, number> = {};

function tapped(name: string, down: boolean, dt: number, repeats = false): boolean {
    if (!down) { delete held[name]; return false; }
    const before = held[name];
    held[name] = (before ?? 0) + dt;
    if (before === undefined) return true;
    if (!repeats || held[name]! < REPEAT) return false;
    held[name] = 0.0001;
    return true;
}

const stepped = (ladder: readonly number[], now: number, by: number): number => {
    const next = by > 0 ? ladder.find((v) => v > now + 1e-6) : [...ladder].reverse().find((v) => v < now - 1e-6);
    return next ?? now;
};

export function setEngine(order: number): void { helm.order = Math.max(0, Math.min(1, order)); }
export function setRudder(order: number): void { helm.rudder = Math.max(-1, Math.min(1, order)); helm.mode = 'manual'; }
export function setElevation(degrees: number): void { helm.elevation = Math.max(-30, Math.min(30, degrees)); helm.mode = 'manual'; }
export function steady(): void { helm.rudder = 0; helm.elevation = Math.max(-30, Math.min(30, Math.round((helm.pitch * 180) / Math.PI / 15) * 15)); helm.mode = 'manual'; }
export function engage(mode: HelmMode): void {
    if (mode === 'approach' && !helm.aim) return;
    helm.mode = helm.mode === mode ? 'manual' : mode;
    if (helm.mode === 'manual') steady();
}

export function stepHelm(keys: HelmKeys, dt: number): Vec {
    if (tapped('ahead', keys.ahead, dt, true)) setEngine(stepped(ENGINE_ORDERS, helm.order, 1));
    if (tapped('astern', keys.astern, dt, true)) setEngine(stepped(ENGINE_ORDERS, helm.order, -1));
    if (tapped('port', keys.port, dt, true)) setRudder(stepped(RUDDER_ORDERS, helm.rudder, -1));
    if (tapped('starboard', keys.starboard, dt, true)) setRudder(stepped(RUDDER_ORDERS, helm.rudder, 1));
    if (tapped('climb', keys.climb, dt, true)) setElevation(stepped(ELEVATION_ORDERS, helm.elevation, 1));
    if (tapped('dive', keys.dive, dt, true)) setElevation(stepped(ELEVATION_ORDERS, helm.elevation, -1));
    if (tapped('steady', keys.steady, dt)) steady();
    if (tapped('approach', keys.approach, dt)) engage('approach');
    if (tapped('align', keys.align, dt)) engage('align');
    if (helm.mode === 'approach' && !helm.aim) steady();

    let want = { yaw: -helm.rudder * TURN, pitch: Math.max(-TURN * 0.8, Math.min(TURN * 0.8, ((helm.elevation * Math.PI) / 180 - helm.pitch) * 1.4)) };
    const to = helm.mode === 'approach' ? helm.aim : helm.mode === 'align' ? helm.gate : null;
    if (to) {
        const flat = Math.hypot(to.x, to.z);
        const off = { yaw: wrapped(Math.atan2(to.x, to.z) - helm.yaw), pitch: Math.atan2(to.y, flat || 1e-6) - helm.pitch };
        want = { yaw: Math.max(-TURN, Math.min(TURN, off.yaw * 1.4)), pitch: Math.max(-TURN * 0.8, Math.min(TURN * 0.8, off.pitch * 1.4)) };
        helm.rudder = -want.yaw / TURN;
        helm.elevation = Math.max(-60, Math.min(60, ((helm.pitch + off.pitch) * 180) / Math.PI));
    }
    helm.yawRate += (want.yaw - helm.yawRate) * Math.min(1, dt * 2.4);
    helm.pitchRate += (want.pitch - helm.pitchRate) * Math.min(1, dt * 2.4);
    helm.yaw = wrapped(helm.yaw + helm.yawRate * dt);
    helm.pitch = Math.max(-1.2, Math.min(1.2, helm.pitch + helm.pitchRate * dt));
    helm.helmAngle = -helm.yawRate / TURN;
    helm.roll += ((-helm.yawRate / TURN) * BANK - helm.roll) * Math.min(1, dt * 1.8);
    helm.viewYaw += wrapped(helm.yaw - helm.viewYaw) * Math.min(1, dt * 1.6);
    helm.viewPitch += (helm.pitch - helm.viewPitch) * Math.min(1, dt * 1.2);

    helm.attitude = facing(helm.yaw, helm.pitch, helm.roll);
    helm.level = facing(helm.yaw, helm.pitch);
    helm.frame = facing(helm.viewYaw, helm.viewPitch * 0.85);
    helm.forward = turnBy(helm.level, { x: 0, y: 0, z: 1 });

    const run = ship.speed * FIELD_DRIFT * dt;
    const moved = { x: -helm.forward.x * run, y: -helm.forward.y * run, z: -helm.forward.z * run };
    helm.gate = { x: helm.gate.x + moved.x, y: helm.gate.y + moved.y, z: helm.gate.z + moved.z };
    helm.arrived = false;
    if (Math.hypot(helm.gate.x, helm.gate.y, helm.gate.z) < GATE_REACH) {
        helm.arrived = true;
        helm.arrivals++;
        helm.leg = (helm.leg % 9) + 1;
        helm.gateName = GATES[helm.arrivals % GATES.length]!;
        const bearing = helm.yaw + 1.9 + helm.arrivals * 0.7, far = 5200;
        helm.gate = { x: Math.sin(bearing) * far, y: ((helm.arrivals * 37) % 9 - 4) * 90, z: Math.cos(bearing) * far };
        if (helm.mode === 'align') steady();
    }
    return moved;
}
