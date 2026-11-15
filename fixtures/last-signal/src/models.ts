export type Shape = 'cube' | 'cylinder' | 'sphere' | 'cone';
export type Role = 'body' | 'beacon' | 'spinner' | 'rotor' | 'cargo' | 'antenna' | 'emitter' | 'beam';
export interface Colour { r: number; g: number; b: number; a: number }

export interface Part {
    shape: Shape;
    at: [number, number, number];
    size: [number, number, number];
    colour: Colour;
    lit: boolean;
    role: Role;
}

const rgb = (r: number, g: number, b: number): Colour => ({ r, g, b, a: 1 });

export const PALETTE = {
    steel: rgb(0.2, 0.22, 0.25),
    plate: rgb(0.34, 0.36, 0.4),
    mine: rgb(0.93, 0.5, 0.14),
    mineGlow: rgb(1, 0.72, 0.2),
    store: rgb(0.16, 0.5, 0.92),
    storeGlow: rgb(0.35, 0.85, 1),
    drone: rgb(0.86, 0.88, 0.9),
    droneGlow: rgb(0.4, 1, 0.6),
    ore: rgb(0.95, 0.55, 0.15),
    ok: { r: 0.3, g: 1, b: 0.5, a: 0.45 },
    blocked: { r: 1, g: 0.25, b: 0.25, a: 0.45 },
    offline: rgb(1, 0.22, 0.16),
    online: rgb(0.35, 0.85, 1),
    beam: { r: 0.45, g: 0.9, b: 1, a: 0.55 },
    select: rgb(0.6, 0.95, 1),
    cursor: rgb(1, 1, 1),
};

const part = (shape: Shape, at: [number, number, number], size: [number, number, number], colour: Colour, role: Role = 'body', lit = true): Part =>
    ({ shape, at, size, colour, lit, role });

export function mineParts(): Part[] {
    return [
        part('cube', [0, 0.1, 0], [1.8, 0.2, 1.8], PALETTE.steel),
        part('cube', [-0.25, 0.65, 0.1], [1.0, 0.9, 1.2], PALETTE.mine),
        part('cube', [-0.25, 1.15, 0.1], [1.1, 0.1, 1.3], PALETTE.plate),
        part('cylinder', [0.5, 1.1, -0.45], [0.36, 1.8, 0.36], PALETTE.steel),
        part('cone', [0.5, 2.25, -0.45], [0.5, 0.5, 0.5], PALETTE.mine, 'spinner'),
        part('cube', [0.5, 1.7, -0.45], [0.9, 0.08, 0.08], PALETTE.plate, 'spinner'),
        part('cube', [0.55, 0.45, 0.5], [0.6, 0.5, 0.6], PALETTE.plate),
        part('cube', [0.55, 0.74, 0.5], [0.44, 0.1, 0.44], PALETTE.ore, 'body', false),
        part('cube', [-0.25, 0.5, 0.72], [0.5, 0.08, 0.04], PALETTE.mineGlow, 'beacon', false),
        part('sphere', [-0.6, 1.32, 0.5], [0.2, 0.2, 0.2], PALETTE.mineGlow, 'beacon', false),
    ];
}

export function storeParts(): Part[] {
    return [
        part('cube', [0, 0.1, 0], [1.8, 0.2, 1.8], PALETTE.steel),
        part('cylinder', [-0.42, 0.95, -0.35], [0.8, 1.5, 0.8], PALETTE.store),
        part('cylinder', [0.42, 0.75, -0.35], [0.8, 1.1, 0.8], PALETTE.store),
        part('sphere', [-0.42, 1.7, -0.35], [0.8, 0.36, 0.8], PALETTE.plate),
        part('sphere', [0.42, 1.3, -0.35], [0.8, 0.36, 0.8], PALETTE.plate),
        part('cube', [0, 0.5, 0.45], [1.5, 0.6, 0.7], PALETTE.plate),
        part('cube', [0, 0.84, 0.45], [1.6, 0.08, 0.8], PALETTE.steel),
        part('cube', [0, 0.45, 0.81], [0.6, 0.45, 0.04], PALETTE.steel),
        part('cube', [0, 0.72, 0.81], [1.3, 0.06, 0.04], PALETTE.storeGlow, 'beacon', false),
        part('sphere', [0.42, 1.52, -0.35], [0.18, 0.18, 0.18], PALETTE.storeGlow, 'beacon', false),
    ];
}

export function droneParts(): Part[] {
    const arms: Part[] = [];
    for (const [x, z] of [[0.42, 0.42], [-0.42, 0.42], [0.42, -0.42], [-0.42, -0.42]] as const) {
        arms.push(part('cube', [x / 2, 0, z / 2], [0.5, 0.05, 0.08], PALETTE.steel));
        arms.push(part('cylinder', [x, 0.06, z], [0.4, 0.02, 0.4], PALETTE.plate, 'rotor'));
    }
    return [
        part('cube', [0, 0, 0], [0.5, 0.16, 0.7], PALETTE.drone),
        part('cube', [0, 0.1, -0.1], [0.3, 0.08, 0.3], PALETTE.steel),
        ...arms,
        part('cube', [0, -0.2, 0], [0.34, 0.24, 0.34], PALETTE.ore, 'cargo'),
        part('sphere', [0, 0.02, 0.36], [0.1, 0.1, 0.1], PALETTE.droneGlow, 'beacon', false),
    ];
}

export function ringParts(colour: Colour, half: number, lift: number): Part[] {
    const t = 0.1;
    return [
        part('cube', [0, lift, half], [half * 2 + t, t, t], colour, 'body', false),
        part('cube', [0, lift, -half], [half * 2 + t, t, t], colour, 'body', false),
        part('cube', [half, lift, 0], [t, t, half * 2 + t], colour, 'body', false),
        part('cube', [-half, lift, 0], [t, t, half * 2 + t], colour, 'body', false),
    ];
}

export function towerParts(): Part[] {
    const legs: Part[] = [];
    for (const [x, z] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]] as const) {
        legs.push(part('cube', [x, 1.9, z], [0.12, 2.4, 0.12], PALETTE.steel));
        legs.push(part('sphere', [x, 3.16, z], [0.16, 0.16, 0.16], PALETTE.offline, 'beacon', false));
    }
    return [
        part('cube', [0, 0.12, 0], [1.9, 0.24, 1.9], PALETTE.steel),
        part('cube', [0, 0.5, 0], [1.3, 0.52, 1.3], PALETTE.plate),
        part('cube', [0, 0.5, 0.66], [0.7, 0.1, 0.04], PALETTE.offline, 'beacon', false),
        ...legs,
        part('cube', [0, 1.6, 0], [1.14, 0.08, 1.14], PALETTE.plate),
        part('cube', [0, 3.06, 0], [1.14, 0.1, 1.14], PALETTE.plate),
        part('cylinder', [0, 2.3, 0], [0.26, 3.2, 0.26], PALETTE.steel),
        part('sphere', [0, 2.5, 0.42], [0.9, 0.9, 0.22], PALETTE.drone),
        part('cone', [0, 2.5, 0.6], [0.16, 0.3, 0.16], PALETTE.steel),
        part('cylinder', [0, 4.2, 0], [0.1, 1.9, 0.1], PALETTE.plate, 'antenna'),
        part('cube', [0, 4.3, 0], [1.0, 0.06, 0.06], PALETTE.plate, 'antenna'),
        part('cube', [0, 4.65, 0], [0.06, 0.06, 0.7], PALETTE.plate, 'antenna'),
        part('cube', [0, 4.95, 0], [0.45, 0.06, 0.06], PALETTE.plate, 'antenna'),
        part('sphere', [0, 5.25, 0], [0.34, 0.34, 0.34], PALETTE.offline, 'emitter', false),
        part('cylinder', [0, 5.3, 0], [0.3, 1, 0.3], PALETTE.beam, 'beam', false),
    ];
}
