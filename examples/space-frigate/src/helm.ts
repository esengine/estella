import { FIELD_DRIFT, ship } from './shipState';

export type Vec = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export const METRES = 1 / FIELD_DRIFT;
export const TURN_RATE = 0.3;
export const PITCH_RATE = 0.24;
export const YAW_THRUST = 0.14;
export const PITCH_THRUST = 0.11;
export const ROLL_RATE = 0.35;
export const ROLL_THRUST = 0.2;
const LEVEL = 0.004;
const THRUST_GAIN = 4;
const BANK = 0.5;
const GATES = ['KESTREL GATE', 'TARN RELAY', 'OSSA ANCHORAGE'] as const;
const REPEAT = 0.32;

export const ENGINE_ORDERS = [0, 0.25, 0.5, 0.75, 1] as const;
export const RUDDER_ORDERS = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1] as const;
export const ELEVATION_ORDERS = [-1, -0.5, 0, 0.5, 1] as const;
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
const within = (v: number, most: number): number => Math.max(-most, Math.min(most, v));

function toward(from: Quat, to: Quat, share: number): Quat {
    const same = from.x * to.x + from.y * to.y + from.z * to.z + from.w * to.w < 0 ? -1 : 1;
    const q = { x: from.x + (to.x * same - from.x) * share, y: from.y + (to.y * same - from.y) * share, z: from.z + (to.z * same - from.z) * share, w: from.w + (to.w * same - from.w) * share };
    const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

export type HelmMode = 'manual' | 'approach' | 'align' | 'level';

export const helm = {
    yaw: 0, pitch: 0, roll: 0, lean: 0, yawRate: 0, pitchRate: 0, rollRate: 0,
    jets: { yaw: 0, pitch: 0, roll: 0 },
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

export interface HelmKeys { ahead: boolean; astern: boolean; port: boolean; starboard: boolean; climb: boolean; dive: boolean; steady: boolean; approach: boolean; align: boolean; level: boolean }

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
export function setElevation(order: number): void { helm.elevation = within(order, 1); helm.mode = 'manual'; }
export function steady(): void { helm.rudder = 0; helm.elevation = 0; helm.mode = 'manual'; }
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
    if (tapped('level', keys.level, dt)) engage('level');
    if (helm.mode === 'approach' && !helm.aim) steady();

    let want = { yaw: -helm.rudder * TURN_RATE, pitch: helm.elevation * PITCH_RATE, roll: 0 };
    const to = helm.mode === 'approach' ? helm.aim : helm.mode === 'align' ? helm.gate : null;
    if (to) {
        const ahead = turnBack(helm.level, to);
        want = { yaw: within(Math.atan2(ahead.x, ahead.z) * 1.4, TURN_RATE), pitch: within(Math.atan2(ahead.y, Math.hypot(ahead.x, ahead.z) || 1e-6) * 1.4, PITCH_RATE), roll: 0 };
        helm.rudder = -want.yaw / TURN_RATE;
        helm.elevation = want.pitch / PITCH_RATE;
    }
    if (helm.mode === 'level') {
        const climb = Math.asin(Math.max(-1, Math.min(1, helm.forward.y)));
        if (Math.abs(helm.lean) < LEVEL && Math.abs(climb) < LEVEL && Math.abs(helm.rollRate) + Math.abs(helm.pitchRate) + Math.abs(helm.yawRate) < LEVEL) {
            steady();
        } else {
            want = { yaw: 0, pitch: within(-climb * 1.4 * Math.max(0, Math.cos(helm.lean)), PITCH_RATE), roll: within(-helm.lean * 1.4, ROLL_RATE) };
            helm.rudder = 0;
            helm.elevation = want.pitch / PITCH_RATE;
        }
    }
    const push = { yaw: within((want.yaw - helm.yawRate) * THRUST_GAIN, YAW_THRUST), pitch: within((want.pitch - helm.pitchRate) * THRUST_GAIN, PITCH_THRUST), roll: within((want.roll - helm.rollRate) * THRUST_GAIN, ROLL_THRUST) };
    helm.yawRate += push.yaw * dt;
    helm.pitchRate += push.pitch * dt;
    helm.rollRate += push.roll * dt;
    helm.jets = { yaw: push.yaw / YAW_THRUST, pitch: push.pitch / PITCH_THRUST, roll: push.roll / ROLL_THRUST };
    helm.level = toward(helm.level, mulQuat(mulQuat(mulQuat(helm.level, about('y', helm.yawRate * dt)), about('x', -helm.pitchRate * dt)), about('z', helm.rollRate * dt)), 1);
    helm.helmAngle = -helm.yawRate / TURN_RATE;
    helm.roll += ((-helm.yawRate / TURN_RATE) * BANK - helm.roll) * Math.min(1, dt * 1.8);
    helm.attitude = mulQuat(helm.level, about('z', helm.roll));
    helm.frame = toward(helm.frame, helm.level, Math.min(1, dt * 1.6));
    helm.forward = turnBy(helm.level, { x: 0, y: 0, z: 1 });
    helm.yaw = Math.atan2(helm.forward.x, helm.forward.z);
    helm.pitch = Math.asin(Math.max(-1, Math.min(1, helm.forward.y)));
    helm.lean = Math.atan2(turnBy(helm.level, { x: 1, y: 0, z: 0 }).y, turnBy(helm.level, { x: 0, y: 1, z: 0 }).y);

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
