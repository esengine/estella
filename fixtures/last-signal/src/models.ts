export type Shape = 'cube' | 'cylinder' | 'sphere' | 'cone';
export type Role = 'body' | 'beacon' | 'spinner' | 'rotor' | 'cargo' | 'antenna' | 'emitter' | 'beam' | 'pump' | 'gauge';
export interface Colour { r: number; g: number; b: number; a: number }

export interface Part {
    shape: Shape;
    at: [number, number, number];
    size: [number, number, number];
    colour: Colour;
    lit: boolean;
    role: Role;
    tilt?: [number, number];
}

const rgb = (r: number, g: number, b: number): Colour => ({ r, g, b, a: 1 });

export const PALETTE = {
    sand: rgb(0.7, 0.5, 0.34),
    sandDark: rgb(0.56, 0.38, 0.26),
    sandLight: rgb(0.8, 0.6, 0.42),
    rock: rgb(0.4, 0.27, 0.2),
    rockDark: rgb(0.28, 0.19, 0.15),
    pad: rgb(0.4, 0.41, 0.43),
    padSeam: rgb(0.33, 0.34, 0.36),
    padLine: rgb(0.85, 0.72, 0.3),
    steel: rgb(0.2, 0.23, 0.27),
    plate: rgb(0.52, 0.56, 0.6),
    hull: rgb(0.86, 0.88, 0.9),
    hazard: rgb(0.95, 0.74, 0.12),
    mine: rgb(0.93, 0.45, 0.12),
    mineGlow: rgb(1, 0.66, 0.18),
    store: rgb(0.14, 0.46, 0.86),
    storeGlow: rgb(0.35, 0.85, 1),
    solar: rgb(0.08, 0.2, 0.55),
    solarLine: rgb(0.45, 0.65, 0.95),
    solarGlow: rgb(1, 0.88, 0.35),
    battery: rgb(0.13, 0.33, 0.36),
    batteryGlow: rgb(0.35, 1, 0.55),
    idle: rgb(0.32, 0.33, 0.36),
    offline: rgb(1, 0.22, 0.16),
    online: rgb(0.35, 0.85, 1),
    beam: { r: 0.45, g: 0.9, b: 1, a: 0.55 },
    drone: rgb(0.9, 0.92, 0.94),
    droneGlow: rgb(0.4, 1, 0.6),
    ore: rgb(1, 0.56, 0.14),
    ok: { r: 0.3, g: 1, b: 0.5, a: 0.45 },
    blocked: { r: 1, g: 0.25, b: 0.25, a: 0.45 },
    select: rgb(0.6, 0.95, 1),
    cursor: rgb(1, 1, 1),
    grid: { r: 1, g: 1, b: 1, a: 0.16 },
};

const part = (shape: Shape, at: [number, number, number], size: [number, number, number], colour: Colour, role: Role = 'body', lit = true, tilt?: [number, number]): Part =>
    ({ shape, at, size, colour, lit, role, ...(tilt ? { tilt } : {}) });

const pad = (colour: Colour): Part[] => [
    part('cube', [0, 0.07, 0], [1.92, 0.14, 1.92], PALETTE.steel),
    part('cube', [0, 0.145, 0.9], [1.92, 0.02, 0.1], colour),
    part('cube', [0, 0.145, -0.9], [1.92, 0.02, 0.1], colour),
];

export function mineParts(): Part[] {
    const legs: Part[] = [];
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        legs.push(part('cube', [0.38 + x * 0.26, 1.45, -0.3 + z * 0.26], [0.09, 2.7, 0.09], PALETTE.steel, 'body', true, [z * 0.13, -x * 0.13]));
    }
    return [
        ...pad(PALETTE.hazard),
        part('cube', [-0.42, 0.56, 0.3], [0.95, 0.84, 1.0], PALETTE.mine),
        part('cube', [-0.42, 1.02, 0.3], [1.05, 0.1, 1.1], PALETTE.plate),
        part('cylinder', [-0.7, 1.3, 0.05], [0.2, 0.5, 0.2], PALETTE.steel),
        part('cube', [-0.42, 0.52, 0.82], [0.5, 0.36, 0.04], PALETTE.steel),
        ...legs,
        part('cube', [0.38, 2.78, -0.3], [0.5, 0.1, 0.5], PALETTE.plate),
        part('cube', [0.38, 1.5, -0.3], [0.72, 0.06, 0.72], PALETTE.plate),
        part('cylinder', [0.38, 1.5, -0.3], [0.13, 2.7, 0.13], PALETTE.hull, 'spinner'),
        part('cube', [0.38, 2.2, -0.3], [0.46, 0.08, 0.1], PALETTE.hazard, 'spinner'),
        part('cube', [0.38, 2.5, -0.3], [0.3, 0.22, 0.3], PALETTE.mine, 'pump'),
        part('cube', [0.52, 0.36, 0.56], [0.66, 0.44, 0.6], PALETTE.plate),
        part('sphere', [0.42, 0.62, 0.5], [0.34, 0.26, 0.34], PALETTE.ore, 'gauge', false),
        part('sphere', [0.66, 0.6, 0.64], [0.26, 0.22, 0.26], PALETTE.ore, 'gauge', false),
        part('sphere', [0.38, 2.92, -0.3], [0.2, 0.2, 0.2], PALETTE.mineGlow, 'beacon', false),
    ];
}

export function storeParts(): Part[] {
    return [
        ...pad(PALETTE.storeGlow),
        part('sphere', [-0.12, 0.14, -0.2], [1.62, 1.9, 1.34], PALETTE.store),
        part('cube', [-0.12, 0.4, -0.2], [1.66, 0.14, 1.38], PALETTE.plate),
        part('cube', [-0.12, 0.52, 0.52], [0.9, 0.76, 0.3], PALETTE.plate),
        part('cube', [-0.12, 0.46, 0.68], [0.62, 0.6, 0.04], PALETTE.steel),
        part('cube', [-0.12, 0.84, 0.68], [0.7, 0.07, 0.05], PALETTE.storeGlow, 'beacon', false),
        part('cube', [0.7, 0.3, 0.62], [0.34, 0.32, 0.34], PALETTE.mine),
        part('cube', [0.66, 0.6, 0.6], [0.28, 0.28, 0.28], PALETTE.plate),
        part('cube', [0.74, 0.28, 0.2], [0.3, 0.28, 0.3], PALETTE.store),
        part('cylinder', [-0.72, 1.0, -0.66], [0.06, 1.7, 0.06], PALETTE.steel),
        part('sphere', [-0.72, 1.88, -0.66], [0.14, 0.14, 0.14], PALETTE.storeGlow, 'beacon', false),
    ];
}

export function solarParts(): Part[] {
    const panels: Part[] = [];
    for (const x of [-0.48, 0.48]) {
        panels.push(part('cube', [x, 1.02, 0], [0.9, 0.05, 1.5], PALETTE.solar, 'body', true, [0.6, 0]));
        for (const row of [-0.42, 0, 0.42]) {
            panels.push(part('cube', [x, 1.02 - row * 0.565 + 0.03, row * 0.825], [0.9, 0.015, 0.03], PALETTE.solarLine, 'body', true, [0.6, 0]));
        }
        panels.push(part('cube', [x, 1.05, 0], [0.03, 0.015, 1.5], PALETTE.solarLine, 'body', true, [0.6, 0]));
    }
    return [
        part('cylinder', [0, 0.07, 0], [1.3, 0.14, 1.3], PALETTE.steel),
        part('cylinder', [0, 0.5, 0], [0.22, 0.8, 0.22], PALETTE.plate),
        part('cube', [0, 0.9, 0], [1.9, 0.08, 0.14], PALETTE.plate),
        ...panels,
        part('cube', [0, 0.26, 0.5], [0.34, 0.28, 0.2], PALETTE.plate),
        part('sphere', [0, 0.46, 0.5], [0.14, 0.14, 0.14], PALETTE.solarGlow, 'beacon', false),
    ];
}

export function batteryParts(): Part[] {
    const cells: Part[] = [];
    for (const x of [-0.58, 0, 0.58]) {
        cells.push(part('cylinder', [x, 0.84, -0.12], [0.5, 1.4, 0.5], PALETTE.battery));
        cells.push(part('cylinder', [x, 1.58, -0.12], [0.36, 0.1, 0.36], PALETTE.plate));
        cells.push(part('cylinder', [x, 0.2, -0.12], [0.56, 0.12, 0.56], PALETTE.plate));
        cells.push(part('cube', [x, 0.84, 0.15], [0.14, 1.1, 0.04], PALETTE.steel));
        cells.push(part('cube', [x, 0.84, 0.17], [0.1, 1.04, 0.03], PALETTE.batteryGlow, 'gauge', false));
    }
    return [
        ...pad(PALETTE.batteryGlow),
        ...cells,
        part('cube', [0, 0.34, 0.62], [1.6, 0.4, 0.36], PALETTE.plate),
        part('cylinder', [0, 1.5, -0.12], [0.1, 0.1, 1.5], PALETTE.plate, 'body', true, [0, 1.5708]),
        part('sphere', [0.7, 0.62, 0.62], [0.14, 0.14, 0.14], PALETTE.batteryGlow, 'beacon', false),
    ];
}

export function towerParts(): Part[] {
    const legs: Part[] = [];
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        legs.push(part('cube', [x * 0.52, 1.75, z * 0.52], [0.11, 3.3, 0.11], PALETTE.steel, 'body', true, [z * 0.16, -x * 0.16]));
        legs.push(part('sphere', [x * 0.27, 3.42, z * 0.27], [0.16, 0.16, 0.16], PALETTE.offline, 'beacon', false));
    }
    return [
        ...pad(PALETTE.hull),
        part('cube', [0, 0.4, 0], [1.2, 0.52, 1.2], PALETTE.plate),
        part('cube', [0, 0.42, 0.62], [0.6, 0.1, 0.04], PALETTE.offline, 'beacon', false),
        ...legs,
        part('cube', [0, 1.5, 0], [1.02, 0.07, 1.02], PALETTE.plate),
        part('cube', [0, 2.5, 0], [0.74, 0.07, 0.74], PALETTE.plate),
        part('cube', [0, 3.36, 0], [0.7, 0.12, 0.7], PALETTE.plate),
        part('cylinder', [0, 2.2, 0], [0.2, 3.6, 0.2], PALETTE.steel),
        part('sphere', [0, 2.9, 0.5], [1.15, 1.15, 0.26], PALETTE.hull, 'body', true, [-0.5, 0]),
        part('cone', [0, 3.04, 0.72], [0.14, 0.34, 0.14], PALETTE.steel, 'body', true, [1.07, 0]),
        part('cylinder', [0, 4.4, 0], [0.1, 2.0, 0.1], PALETTE.plate, 'antenna'),
        part('cube', [0, 4.5, 0], [1.0, 0.06, 0.06], PALETTE.plate, 'antenna'),
        part('cube', [0, 4.9, 0], [0.06, 0.06, 0.72], PALETTE.plate, 'antenna'),
        part('cube', [0, 5.2, 0], [0.46, 0.06, 0.06], PALETTE.plate, 'antenna'),
        part('sphere', [0, 5.5, 0], [0.36, 0.36, 0.36], PALETTE.offline, 'emitter', false),
        part('cylinder', [0, 5.55, 0], [0.32, 1, 0.32], PALETTE.beam, 'beam', false),
    ];
}

export function droneParts(): Part[] {
    const arms: Part[] = [];
    for (const [x, z] of [[0.42, 0.42], [-0.42, 0.42], [0.42, -0.42], [-0.42, -0.42]] as const) {
        arms.push(part('cube', [x / 2, 0, z / 2], [0.5, 0.05, 0.08], PALETTE.steel));
        arms.push(part('cylinder', [x, 0.06, z], [0.44, 0.02, 0.44], PALETTE.plate, 'rotor'));
        arms.push(part('cylinder', [x, 0.02, z], [0.1, 0.1, 0.1], PALETTE.steel));
    }
    return [
        part('cube', [0, 0, 0], [0.5, 0.16, 0.72], PALETTE.drone),
        part('cube', [0, 0.1, -0.1], [0.3, 0.08, 0.3], PALETTE.store),
        ...arms,
        part('cube', [0, -0.22, 0], [0.36, 0.26, 0.36], PALETTE.ore, 'cargo', false),
        part('sphere', [0, 0.02, 0.38], [0.1, 0.1, 0.1], PALETTE.droneGlow, 'beacon', false),
        part('sphere', [0, -0.06, -0.38], [0.08, 0.08, 0.08], PALETTE.offline, 'beacon', false),
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

export function gridParts(cells: number, cell: number): Part[] {
    const span = cells * cell;
    const lines: Part[] = [];
    for (let i = 0; i <= cells; i += 1) {
        const offset = (i - cells / 2) * cell;
        lines.push(part('cube', [offset, 0.02, 0], [0.05, 0.01, span], PALETTE.grid, 'body', false));
        lines.push(part('cube', [0, 0.02, offset], [span, 0.01, 0.05], PALETTE.grid, 'body', false));
    }
    return lines;
}

function mulberry(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function landParts(half: number): Part[] {
    const random = mulberry(20261114);
    const land: Part[] = [];
    const between = (lo: number, hi: number): number => lo + (hi - lo) * random();
    for (let i = 0; i < 46; i++) {
        const size = between(5, 16);
        const tone = random() < 0.5 ? PALETTE.sandDark : PALETTE.sandLight;
        land.push(part('cylinder', [between(-half, half), 0.006 + i * 0.0002, between(-half, half)], [size, 0.01, size * between(0.6, 1)], tone));
    }
    land.push(part('cube', [-9, 0.03, -3], [44, 0.04, 22], PALETTE.pad));
    for (const z of [-13.6, 7.6]) land.push(part('cube', [-9, 0.055, z], [43, 0.012, 0.16], PALETTE.padLine));
    for (const x of [-30.6, 12.6]) land.push(part('cube', [x, 0.055, -3], [0.16, 0.012, 21], PALETTE.padLine));
    for (let i = 0; i < 9; i++) land.push(part('cube', [-27 + i * 4.5, 0.055, 2.9], [1.6, 0.012, 0.12], PALETTE.plate));
    for (let i = 1; i < 11; i++) land.push(part('cube', [-31 + i * 4, 0.052, -3], [0.06, 0.01, 21.6], PALETTE.padSeam));
    for (let i = 1; i < 6; i++) land.push(part('cube', [-9, 0.052, -14 + i * 4], [43.6, 0.01, 0.06], PALETTE.padSeam));
    for (let i = 0; i < 70; i++) {
        const angle = between(0, Math.PI * 2);
        const reach = between(30, half * 1.25);
        const x = Math.cos(angle) * reach * 1.25 - 9, z = Math.sin(angle) * reach * 0.85 - 3;
        if (Math.abs(x + 9) < 25 && Math.abs(z + 3) < 14) continue;
        const size = between(0.6, 2.6);
        const tone = random() < 0.6 ? PALETTE.rock : PALETTE.rockDark;
        land.push(part(random() < 0.5 ? 'sphere' : 'cube', [x, size * 0.3, z], [size * between(0.8, 1.5), size * between(0.5, 1), size * between(0.8, 1.4)], tone, 'body', true, [between(-0.3, 0.3), between(-0.3, 0.3)]));
        if (random() < 0.5) land.push(part('sphere', [x + size * 0.7, size * 0.16, z + size * 0.4], [size * 0.6, size * 0.4, size * 0.6], PALETTE.rockDark));
    }
    for (let i = 0; i < 26; i++) {
        const angle = (i / 26) * Math.PI * 2 + between(-0.08, 0.08);
        const reach = half * between(1.5, 2.1);
        const height = between(8, 26), width = between(18, 40);
        land.push(part(random() < 0.6 ? 'cube' : 'cylinder', [Math.cos(angle) * reach, height / 2 - 1, Math.sin(angle) * reach], [width, height, width * between(0.6, 1)], random() < 0.5 ? PALETTE.rock : PALETTE.sandDark, 'body', true, [0, between(-0.06, 0.06)]));
        land.push(part('cube', [Math.cos(angle) * reach, height - 1 + 0.6, Math.sin(angle) * reach], [width * 0.7, 1.4, width * 0.5], PALETTE.sandLight));
    }
    return land;
}
