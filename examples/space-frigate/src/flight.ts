export const SHOTS = [
    { yaw: 0.72, pitch: 0.17, distance: 108, height: 1, along: -6 },
    { yaw: 2.55, pitch: 0.05, distance: 74, height: 2, along: -30 },
    { yaw: -0.5, pitch: 0.42, distance: 132, height: 0, along: 4 },
    { yaw: 3.6, pitch: -0.12, distance: 96, height: -2, along: -12 },
    { yaw: 0.95, pitch: 0.2, distance: 36, height: 7, along: -15 },
    { yaw: 0.35, pitch: 0.1, distance: 30, height: 2, along: 18 },
] as const;

export const SHOT_SECONDS = 9;
export const BLEND_SECONDS = 2.5;

export interface Orbit {
    yaw: number;
    pitch: number;
    distance: number;
    height: number;
    along: number;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const smooth = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

export function mixOrbit(a: Orbit, b: Orbit, t: number): Orbit {
    const k = smooth(t);
    let turn = b.yaw - a.yaw;
    turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
    return {
        yaw: a.yaw + turn * k,
        pitch: a.pitch + (b.pitch - a.pitch) * k,
        distance: a.distance + (b.distance - a.distance) * k,
        height: a.height + (b.height - a.height) * k,
        along: a.along + (b.along - a.along) * k,
    };
}

export function tourOrbit(time: number): Orbit {
    const lap = time / SHOT_SECONDS;
    const index = Math.floor(lap) % SHOTS.length;
    const within = (lap - Math.floor(lap)) * SHOT_SECONDS;
    const here = SHOTS[index]!;
    const drift = { ...here, yaw: here.yaw + within * 0.022 };
    const left = SHOT_SECONDS - within;
    if (left >= BLEND_SECONDS) return drift;
    return mixOrbit(drift, SHOTS[(index + 1) % SHOTS.length]!, 1 - left / BLEND_SECONDS);
}

export function eyeOf(o: Orbit): { eye: [number, number, number]; target: [number, number, number] } {
    const target: [number, number, number] = [0, o.height, o.along];
    const flat = Math.cos(o.pitch) * o.distance;
    return { eye: [target[0] + Math.sin(o.yaw) * flat, target[1] + Math.sin(o.pitch) * o.distance, target[2] + Math.cos(o.yaw) * flat], target };
}

export function lookRotation(eye: readonly number[], target: readonly number[]): { x: number; y: number; z: number; w: number } {
    let fx = target[0]! - eye[0]!, fy = target[1]! - eye[1]!, fz = target[2]! - eye[2]!;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, ry = 0, rz = fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const m00 = rx, m01 = ux, m02 = -fx, m10 = ry, m11 = uy, m12 = -fy, m20 = rz, m21 = uz, m22 = -fz;
    const trace = m00 + m11 + m22;
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2;
        return { w: s / 4, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
    }
    if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        return { w: (m21 - m12) / s, x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s };
    }
    if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s };
    }
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4 };
}
