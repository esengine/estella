// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    precipitation.ts
 * @brief   Where and when each raindrop lands: one lattice that the falling drops, their splashes and the rings on water and puddles
 *          are all read from, so a drop lands where its ring opens and its splash is thrown up, at the moment it does.
 *
 * @details The ground is cut into cells PRECIPITATION_CELL_METRES across, twice over (the second set shifted, so no two edges line up).
 *          A cell lets a drop fall now and then at its own pace (`rate` a second, from its hash), each fall numbered n: whether drop n
 *          falls at all (its hash against the rain's density), where in the cell it lands and when are all hashes of the cell and n.
 *          Nothing is stepped or stored: a shader asks the lattice for a cell and a time and knows every drop of it, past and coming.
 *
 *          What uses it: the splashes the 3D rain throws up (postprocess/rainDrops.ts: the last fall, for a moment after it), the Water
 *          shader's rain rings and the rain effect's rings on puddles (the last fall, spreading): a splash and its ring are one landing.
 *          The falling drops are a system of their own, as in any rain dense enough to be real: no eye tells which drop threw which
 *          splash. All read the same intensity, from the rain the scene resolved this frame ({@link currentPrecipitation}).
 */

/** The side of a lattice cell, metres. */
export const PRECIPITATION_CELL_METRES = 0.35;
/** How many sets of cells, each shifted against the others by a step of the golden ratio, so no two line up. */
export const PRECIPITATION_LAYERS = 4;
/** The share of a cell's falls that do fall, a unit of the rain's intensity, and the most that can. */
export const PRECIPITATION_DENSITY_PER_INTENSITY = 0.6;
export const PRECIPITATION_MOST_DENSITY = 0.95;

/** The share of falls that fall at a rain's intensity (the rain effect's, 0 to 2): precipDensity in the shaders. */
export function precipitationDensity(intensity: number): number {
    return Math.min(Math.max(intensity * PRECIPITATION_DENSITY_PER_INTENSITY, 0), PRECIPITATION_MOST_DENSITY);
}

/**
 * The lattice in GLSL (WGSL is derived from it). Cells are numbered in lattice units: a world xz over the cell size, plus the layer's
 * shift. A drop's place comes back in lattice units too; precipWorld turns it into world xz.
 */
export const PRECIPITATION_GLSL = `
float precipHash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
// The lattice point of world xz on a layer, for cells of a given size (world units).
vec2 precipShift(float layer) { return fract(layer * vec2(0.6180340, 0.3819660)); }
vec2 precipLattice(vec2 xz, float cell, float layer) { return xz / cell + precipShift(layer); }
vec2 precipWorld(vec2 lattice, float cell, float layer) { return (lattice - precipShift(layer)) * cell; }
// A cell's own seed, from its corner (whole lattice units) and its layer.
vec2 precipKey(vec2 corner, float layer) { return corner + layer * 113.0; }
// How many falls a second the cell lets through.
float precipRate(vec2 key) { return 0.8 + 0.5 * precipHash(key); }
// Which fall the cell is on at a time: its whole part is the number of the last fall, its fraction how far since it, in falls.
float precipCycle(vec2 key, float time) { return time * precipRate(key) + precipHash(key) * 7.31; }
// When fall n lands, seconds.
float precipLanding(vec2 key, float n) { return (n - precipHash(key) * 7.31) / precipRate(key); }
// The seed of fall n: whether it falls and where it lands.
vec2 precipFall(vec2 key, float n) { return key + n * vec2(17.0, 31.0); }
// Whether fall n falls at a density (the share of falls that do).
bool precipFalls(vec2 key, float n, float density) { return precipHash(precipFall(key, n) + 0.5) <= density; }
// Where fall n lands, in lattice units: within the middle half of its cell.
vec2 precipPlace(vec2 corner, vec2 key, float n) {
    vec2 f = precipFall(key, n);
    return corner + 0.25 + 0.5 * vec2(precipHash(f + 3.1), precipHash(f + 5.7));
}
// The density the lattice lets fall at a rain's intensity (the rain effect's, 0 to 2).
float precipDensity(float intensity) { return clamp(intensity * ${PRECIPITATION_DENSITY_PER_INTENSITY}, 0.0, ${PRECIPITATION_MOST_DENSITY}); }

// One ring of a drop that landed age seconds ago, r cells out: the outward slope there, in cells a cell. A clear crest and a half-high
// one four crest widths behind, running at ring.x m/s for ring.y s, ring.z m wide, ring.w strong (precipitationRing). width is the
// crest's width in cells, never under a pixel: a coarser pixel gets the crest spread and lowered, the same light in it.
float precipRingSlope(float r, float age, float width, vec4 ring) {
    // A ring is gone before it runs three quarters of a cell: past that a drop outside the two by two cells read could reach.
    float life = min(ring.y, 0.75 * ${PRECIPITATION_CELL_METRES} / max(ring.x, 1e-3));
    if (age < 0.0 || age >= life) return 0.0;
    float front = ring.x / ${PRECIPITATION_CELL_METRES} * age;
    float behind = 4.0 * ring.z / ${PRECIPITATION_CELL_METRES};
    float x0 = (r - front) / width, x1 = (r - front + behind) / width;
    float fade = 1.0 - age / life;
    float amp = 0.12 * ring.w * (ring.z / ${PRECIPITATION_CELL_METRES}) / width * fade * fade;
    // The height is a crest and, behind it, a crest half as high: d/dr of A (exp(-x0^2) + 0.5 exp(-x1^2)).
    return amp * (-2.0 * x0 * exp(-x0 * x0) - x1 * exp(-x1 * x1));
}

// The slope the rain's rings give a surface at world xz (dh/dx, dh/dz): every ring near it summed, so meeting crests add and a crest
// meeting a trough cancels. The two by two nearest cells a layer hold every drop a ring can reach from. cell is a cell's side (world
// units); footprint is the world one pixel covers there.
vec2 precipRings(vec2 xz, float time, float density, float cell, float footprint, vec4 ring) {
    vec2 slope = vec2(0.0);
    if (density <= 0.0 || ring.w <= 0.0) return slope;
    float width = max(ring.z / ${PRECIPITATION_CELL_METRES}, footprint / cell);
    for (int layer = 0; layer < ${PRECIPITATION_LAYERS}; layer++) {
        vec2 q = precipLattice(xz, cell, float(layer));
        vec2 base = floor(q - 0.5);
        for (int j = 0; j < 2; j++) {
            for (int i = 0; i < 2; i++) {
                vec2 corner = base + vec2(float(i), float(j));
                vec2 key = precipKey(corner, float(layer));
                float cycle = precipCycle(key, time);
                float n = floor(cycle);
                if (!precipFalls(key, n, density)) continue;
                vec2 d = q - precipPlace(corner, key, n);
                float r = max(length(d), 1e-4);
                slope += d / r * precipRingSlope(r, fract(cycle) / precipRate(key), width, ring);
            }
        }
    }
    return slope;
}
`;

/** The rain falling this frame, as the drops are drawn from it: what the water's rings and the puddles' read so they match. */
export interface PrecipitationState {
    /** The rain's intensity (the rain effect's u_intensity, 0 to 2); the lattice's density is precipDensity of it. */
    intensity: number;
    /** The drops' velocity, world units a second. */
    velocity: [number, number, number];
    /** The rings the drops open: precipRings' ring (see {@link precipitationRing}). */
    ring: PrecipitationRing;
}

/** How a drop's ring looks: how fast it runs (m/s), how long it lasts (s), how wide its crest is (m), and how strong it is. */
export type PrecipitationRing = [speed: number, life: number, width: number, strength: number];

/** A raindrop's ring: a centimetre-wide crest running a quarter metre a second, gone in half a second. */
export const DEFAULT_PRECIPITATION_RING: PrecipitationRing = [0.25, 0.5, 0.006, 1];

/** The ring the rain effect's values ask for (u_ringSpeed, u_ringLife, u_ringWidth, u_ringStrength), the default for any not set. */
export function precipitationRing(get: (name: string) => number | undefined): PrecipitationRing {
    const [speed, life, width, strength] = DEFAULT_PRECIPITATION_RING;
    return [get('u_ringSpeed') ?? speed, get('u_ringLife') ?? life, get('u_ringWidth') ?? width, get('u_ringStrength') ?? strength];
}

let state: PrecipitationState | null = null;

/** Said each frame by what draws the drops: the rain the view resolved, or null where none falls. */
export function setPrecipitation(next: PrecipitationState | null): void {
    state = next;
}

/** The rain falling this frame, or null where none does (or nothing draws drops). */
export function currentPrecipitation(): PrecipitationState | null {
    return state;
}
