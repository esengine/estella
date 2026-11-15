import { FIELD_DRIFT, ship } from './shipState';

export type Vec = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export const METRES = 1 / FIELD_DRIFT;
const TURN = 0.24;
const BANK = 0.5;
const GATES = ['KESTREL GATE', 'TARN RELAY', 'OSSA ANCHORAGE'] as const;
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

export interface HelmKeys { left: boolean; right: boolean; up: boolean; down: boolean; approach: boolean; align: boolean }

let was = { approach: false, align: false };

export function stepHelm(keys: HelmKeys, dt: number): Vec {
    const steer = { yaw: Number(keys.left) - Number(keys.right), pitch: Number(keys.up) - Number(keys.down) };
    if (steer.yaw !== 0 || steer.pitch !== 0) helm.mode = 'manual';
    if (keys.approach && !was.approach && helm.aim) helm.mode = 'approach';
    if (keys.align && !was.align) helm.mode = 'align';
    was = { approach: keys.approach, align: keys.align };
    if (helm.mode === 'approach' && !helm.aim) helm.mode = 'manual';

    let want = { yaw: steer.yaw * TURN, pitch: steer.pitch * TURN * 0.8 };
    const to = helm.mode === 'approach' ? helm.aim : helm.mode === 'align' ? helm.gate : null;
    if (to) {
        const flat = Math.hypot(to.x, to.z);
        const off = { yaw: wrapped(Math.atan2(to.x, to.z) - helm.yaw), pitch: Math.atan2(to.y, flat || 1e-6) - helm.pitch };
        want = { yaw: Math.max(-TURN, Math.min(TURN, off.yaw * 1.4)), pitch: Math.max(-TURN * 0.8, Math.min(TURN * 0.8, off.pitch * 1.4)) };
    }
    helm.yawRate += (want.yaw - helm.yawRate) * Math.min(1, dt * 2.4);
    helm.pitchRate += (want.pitch - helm.pitchRate) * Math.min(1, dt * 2.4);
    helm.yaw = wrapped(helm.yaw + helm.yawRate * dt);
    helm.pitch = Math.max(-1.2, Math.min(1.2, helm.pitch + helm.pitchRate * dt));
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
        if (helm.mode === 'align') helm.mode = 'manual';
    }
    return moved;
}
