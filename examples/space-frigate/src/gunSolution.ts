import { clamp } from './flight';
import type { Vec } from './helm';

const RAD = Math.PI / 180;

export const GUNNERY = {
    traverse: 38 * RAD, elevate: 26 * RAD, low: -8 * RAD, high: 68 * RAD, tolerance: 1.4 * RAD,
    reload: 2.6, boltSpeed: 1400, reach: 2600, convergence: 1500, recoil: 0.6, damage: 0.36,
    doubleTap: 0.32, rippleAfter: 0.4, rippleEvery: 0.22, barrels: 0.5,
    autoEvery: 0.4, settle: 6, laid: 0.2 * RAD, loose: 0.25 * RAD, perKilo: 0.55 * RAD, perSpeed: 0.6 * RAD, settled: 0.25,
} as const;

export interface Battery { key: string; centre: number; half: number }

export const BATTERIES: readonly Battery[] = [
    { key: 'A', centre: 0, half: 150 * RAD },
    { key: 'B', centre: 0, half: 140 * RAD },
    { key: 'P', centre: 85 * RAD, half: 95 * RAD },
    { key: 'S', centre: -85 * RAD, half: 95 * RAD },
    { key: 'V', centre: 0, half: Math.PI },
];

export interface Mount extends Battery { seat: Vec; flipped: boolean; trunnion: Vec; muzzle: number; spread: number }

export interface Turret extends Mount {
    yaw: number;
    pitch: number;
    bears: boolean;
    onTarget: boolean;
    loaded: number;
    kick: number;
    flash: number;
    mouth: Vec;
    bore: Vec;
}

export interface Solution { yaw: number; pitch: number }

export const wrap = (angle: number): number => angle - Math.round(angle / (Math.PI * 2)) * Math.PI * 2;

const inMount = (mount: Mount, v: Vec): Vec => (mount.flipped ? { x: -v.x, y: -v.y, z: v.z } : v);

export function solve(mount: Mount, aim: Vec): Solution {
    const p = inMount(mount, { x: aim.x - mount.seat.x, y: aim.y - mount.seat.y, z: aim.z - mount.seat.z });
    const flat = Math.hypot(p.x, p.z);
    return { yaw: Math.atan2(p.x, p.z), pitch: Math.atan2(p.y - mount.trunnion.y, Math.max(1e-6, flat - mount.trunnion.z)) };
}

export function limit(mount: Battery, want: Solution): Solution & { bears: boolean } {
    const off = wrap(want.yaw - mount.centre);
    const full = mount.half >= Math.PI - 1e-6;
    const yaw = full ? want.yaw : mount.centre + clamp(off, -mount.half, mount.half);
    const pitch = clamp(want.pitch, GUNNERY.low, GUNNERY.high);
    return { yaw, pitch, bears: (full || Math.abs(off) <= mount.half) && want.pitch >= GUNNERY.low && want.pitch <= GUNNERY.high };
}

export function slew(mount: Battery, now: Solution, to: Solution, dt: number): Solution {
    const full = mount.half >= Math.PI - 1e-6;
    const gap = full ? wrap(to.yaw - now.yaw) : wrap(to.yaw - mount.centre) - wrap(now.yaw - mount.centre);
    const turn = clamp(gap, -GUNNERY.traverse * dt, GUNNERY.traverse * dt);
    const lift = clamp(to.pitch - now.pitch, -GUNNERY.elevate * dt, GUNNERY.elevate * dt);
    return { yaw: full ? wrap(now.yaw + turn) : now.yaw + turn, pitch: now.pitch + lift };
}

export function boreOf(mount: Mount, at: Solution): Vec {
    const flat = Math.cos(at.pitch);
    return inMount(mount, { x: Math.sin(at.yaw) * flat, y: Math.sin(at.pitch), z: Math.cos(at.yaw) * flat });
}

export function muzzleOf(mount: Mount, at: Solution, side: number, back = 0): Vec {
    const reach = mount.muzzle - back;
    const lift = mount.trunnion.y + Math.sin(at.pitch) * reach, out = mount.trunnion.z + Math.cos(at.pitch) * reach;
    const local = inMount(mount, { x: Math.cos(at.yaw) * side + Math.sin(at.yaw) * out, y: lift, z: -Math.sin(at.yaw) * side + Math.cos(at.yaw) * out });
    return { x: mount.seat.x + local.x, y: mount.seat.y + local.y, z: mount.seat.z + local.z };
}

export function rayToSphere(from: Vec, way: Vec, centre: Vec, radius: number): number {
    const to = { x: centre.x - from.x, y: centre.y - from.y, z: centre.z - from.z };
    const along = to.x * way.x + to.y * way.y + to.z * way.z;
    const off = to.x * to.x + to.y * to.y + to.z * to.z - along * along;
    if (along <= 0 || off > radius * radius) return Infinity;
    return along - Math.sqrt(radius * radius - off);
}

export function intercept(at: Vec, velocity: Vec, speed: number): { point: Vec; time: number } {
    let time = Math.hypot(at.x, at.y, at.z) / speed;
    let point = at;
    for (let pass = 0; pass < 4; pass++) {
        point = { x: at.x + velocity.x * time, y: at.y + velocity.y * time, z: at.z + velocity.z * time };
        time = Math.hypot(point.x, point.y, point.z) / speed;
    }
    return { point, time };
}

export function crossing(at: Vec, velocity: Vec): number {
    const far = Math.hypot(at.x, at.y, at.z) || 1;
    const along = (at.x * velocity.x + at.y * velocity.y + at.z * velocity.z) / far;
    return Math.sqrt(Math.max(0, velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z - along * along));
}

export function dispersion(range: number, across: number, held: number): number {
    const found = clamp(held / GUNNERY.settle, 0, 1);
    const unsure = 1 - (1 - GUNNERY.settled) * found;
    return GUNNERY.loose + (GUNNERY.perKilo * (range / 1000) + GUNNERY.perSpeed * (across / 100)) * unsure;
}

export function scatter(way: Vec, angle: number, a: number, b: number): Vec {
    const side = Math.abs(way.y) < 0.9 ? { x: way.z, y: 0, z: -way.x } : { x: 1, y: 0, z: 0 };
    const sl = Math.hypot(side.x, side.y, side.z) || 1;
    const u = { x: side.x / sl, y: side.y / sl, z: side.z / sl };
    const v = { x: way.y * u.z - way.z * u.y, y: way.z * u.x - way.x * u.z, z: way.x * u.y - way.y * u.x };
    const off = Math.tan(angle * Math.sqrt(clamp(a, 0, 1))), turn = b * Math.PI * 2;
    const out = { x: way.x + (u.x * Math.cos(turn) + v.x * Math.sin(turn)) * off, y: way.y + (u.y * Math.cos(turn) + v.y * Math.sin(turn)) * off, z: way.z + (u.z * Math.cos(turn) + v.z * Math.sin(turn)) * off };
    const l = Math.hypot(out.x, out.y, out.z) || 1;
    return { x: out.x / l, y: out.y / l, z: out.z / l };
}
