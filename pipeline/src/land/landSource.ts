// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  landSource.ts — a piece of country written as steps: what a `.esland` holds.
 *
 * A heightmap painted by hand is a picture nobody can read back; one made by a script is numbers nobody can look at. A land source
 * is the middle: the ground as the things it is made of (a plateau, a ridge, a river with the heights its water runs at, a road
 * that may not be steeper than it says), run in order over a grid of heights, with what each one did measured in the reply.
 * The same shape a `.esmodel` is for a mesh. Everything is in the scene's own world units; angles are degrees.
 */

/** The file a land source is saved as; its heightmap and maps are written beside it. */
export const LAND_SOURCE_EXT = '.esland';

/** A place on the ground: [x, z]. */
export type Point2 = readonly [number, number];

/**
 * Where a step, a layer or a map applies, 0 to 1, every key given holding at once: by height, by slope, inside a circle or an
 * outline, by a noise of its own, by what it is near (or far from), by a layer's weight.
 */
export interface Where {
    /** Heights: only above, only below, each fading in over `feather` world units (default 2% of the land's height range). */
    above?: number;
    below?: number;
    feather?: number;
    /** Slopes, in degrees from level, each fading over 4 degrees. */
    steeper?: number;
    gentler?: number;
    /** Inside a circle, fading out over its `feather` beyond the radius. */
    within?: { at: Point2; radius: number; feather?: number };
    /** Inside a closed outline, fading out over `outlineFeather` beyond it. */
    outline?: readonly Point2[];
    outlineFeather?: number;
    /** Patches: a noise of blobs `scale` across covering about `cover` (0..1) of the ground, their edges `soft` (0..1). */
    noise?: { scale: number; cover?: number; soft?: number; seed?: number };
    /** Within `within` of the nearest river, road, lake or coast (inland of it), fading out over `fade` more. */
    near?: { what: 'river' | 'road' | 'lake' | 'coast'; within: number; fade?: number };
    /** The opposite: none of it within `within`, all of it `fade` further out. */
    far?: { what: 'river' | 'road' | 'lake' | 'coast'; within: number; fade?: number };
    /** By the weight an earlier layer has there (layers and maps only). */
    layer?: string;
}

interface StepBase { id?: string; where?: Where }

/** A river's or a road's line: [x, z], or [x, z, y] where its height is said, or [x, z, y, width] for a river. */
export type LinePoint = readonly [number, number] | readonly [number, number, number] | readonly [number, number, number, number];

export type LandStep = StepBase & (
    | { op: 'fill'; height: number }
    | { op: 'noise'; amplitude: number; scale: number; octaves?: number; seed?: number; ridged?: number; warp?: number }
    | { op: 'hill'; at: Point2; radius: number; height: number; flat?: number }
    | { op: 'ridge'; path: readonly Point2[]; height: number; width: number; peaks?: number; spurs?: number; straight?: boolean; seed?: number }
    | { op: 'plateau'; at?: Point2; radius?: number; outline?: readonly Point2[]; height: number; edge: number; ragged?: number; ledges?: number; tilt?: readonly [number, number]; seed?: number }
    | { op: 'lake'; name?: string; at: Point2; radius: number; level: number; depth: number; shore?: number; ragged?: number; seed?: number }
    | { op: 'river'; name?: string; path: readonly LinePoint[]; width: number; depth?: number; bank?: number; plain?: number; valley?: number; straight?: boolean; seed?: number }
    | { op: 'road'; name?: string; path: readonly LinePoint[]; width: number; grade?: number; side?: number; straight?: boolean }
    | { op: 'flatten'; at: Point2; radius: number; height?: number; falloff?: number }
    | { op: 'terrace'; step: number; sharp?: number; phase?: number; drift?: number; seed?: number }
    | { op: 'pillars'; at: Point2; radius: number; spacing: number; height: readonly [number, number]; width: readonly [number, number]; clearings?: number; seed?: number }
    | { op: 'coast'; at?: Point2; radius?: number; outline?: readonly Point2[]; ragged?: number; beach: number; cliffs?: number; shelf?: readonly [number, number]; floor: number; seed?: number }
    | { op: 'smooth'; radius?: number; passes?: number }
    | { op: 'erode'; amount: number; seed?: number }
    | { op: 'valley'; path: readonly LinePoint[]; width: number; depth?: number; floor?: number; walls?: number; straight?: boolean; seed?: number }
    | { op: 'crater'; at: Point2; radius: number; depth: number; rim?: number }
    | { op: 'dunes'; height: number; length: number; heading?: number; seed?: number }
    | { op: 'talus'; angle: number; passes?: number }
    | { op: 'sculpt'; strokes: readonly SculptStroke[] }
    | { op: 'stream'; name?: string; from: Point2; width: number; grow?: number; depth?: number; valley?: number; seed?: number }
    | { op: 'image'; file: string; low: number; high: number; at?: Point2; size?: readonly [number, number]; blend?: 'set' | 'add' | 'max' | 'min' }
    | { op: 'clamp'; min?: number; max?: number }
);

/** One stroke of a brush over the ground: what an author's hand does where no rule says it. */
export interface SculptStroke {
    brush: 'raise' | 'lower' | 'smooth' | 'flatten' | 'roughen';
    /** The places it passes, in order; one point is a dab. */
    points: readonly Point2[];
    radius: number;
    /** How far it moves the ground at its middle (raise, lower, roughen), or 0..1 how much of the way it goes (smooth, flatten). */
    by?: number;
    /** The height a flatten goes to; without one, the ground's own where the stroke begins. */
    height?: number;
    /** 0..1: how much of the brush's edge eases away. Default 0.7. */
    soft?: number;
}

export type LandOp = LandStep['op'];

/** One of the ground's layers: where it lies. The first is everywhere, and each later one is laid over those before it. */
export interface LandLayer { name: string; file?: string; where?: Where; amount?: number }

/** A map of numbers over the land (how many plants stand where): written as a grey picture, its Use Data. */
export interface LandMap { name: string; where?: Where; amount?: number }

export interface LandSource {
    version: 1;
    /** The land's size along x and z, and where its middle is. */
    size: readonly [number, number];
    center?: Point2;
    /** Samples along each side: 129, 257, 513, 1025, 2049 or 4097. */
    resolution: number;
    /** The height of the sea, if the land has one: drawn in the pictures, and what a coast runs down to. */
    sea?: number;
    steps: LandStep[];
    layers?: LandLayer[];
    maps?: LandMap[];
}

/** What each op does, in the words the tool's description gives. */
export const LAND_OPS: Readonly<Record<LandOp, { fields: string; does: string }>> = {
    fill: { fields: 'height', does: 'sets the ground to one height: where a land starts' },
    noise: { fields: 'amplitude, scale, octaves?, seed?, ridged?, warp?', does: 'adds rolling ground, hills `scale` across and `amplitude` high from trough to crest; `ridged` 0..1 turns hills to sharp crests, `warp` 0..1 bends them into winding shapes' },
    hill: { fields: 'at, radius, height, flat?', does: 'adds one hill (or with a negative height a hollow), level over `flat` at its top' },
    ridge: { fields: 'path, height, width, peaks?, spurs?, seed?', does: 'raises a range along a line, `width` to each side, its crest broken into peaks (`peaks` 0..1) and its flanks into side ridges (`spurs` 0..1)' },
    plateau: { fields: 'at + radius | outline, height, edge, ragged?, ledges?, tilt?, seed?', does: 'sets a level top at `height` with a cliff `edge` wide round it; `ragged` world units bends the rim, `ledges` cuts the face into that many steps, `tilt` [per x, per z] slopes the top' },
    lake: { fields: 'name?, at, radius, level, depth, shore?, ragged?, seed?', does: 'cuts a bowl whose water stands at `level`, `depth` deep, with a rim raised to hold it' },
    river: { fields: 'name?, path, width, depth?, bank?, plain?, valley?, seed?', does: 'cuts a river along [x, z, y?, width?] points, y the height its water runs at (given at least at its ends, and never rising); a bed, banks, a flood plain `plain` wide, then walls rising `valley` per unit out, so high ground becomes a valley or a gorge. Its line is rounded through its points, as water bends (`straight: true` keeps the corners; so for a road, a valley and a ridge). Two points close together with a drop between them are a fall, and the valley below opens round its foot' },
    road: { fields: 'name?, path, width, grade?, side?', does: 'lays a way along [x, z] points no steeper than `grade` (rise over run, default 0.18, about 10 degrees), cutting and filling the ground to it with sides of slope `side`; the reply says how steep it came out and where' },
    flatten: { fields: 'at, radius, height?, falloff?', does: 'levels a round site, at the ground\'s own height there unless one is given, easing out over `falloff`' },
    terrace: { fields: 'step, sharp?, phase?, drift?, seed?', does: 'cuts slopes into ledges `step` high with faces as sheer as `sharp` (0..1); `drift` lets a ledge\'s height wander so one runs into the next' },
    pillars: { fields: 'at, radius, spacing, height, width, clearings?, seed?', does: 'stands rock pillars in a round region, one a cell of `spacing`, each [lo, hi] high and wide, with a share of `clearings` left empty: a stone forest' },
    coast: { fields: 'at + radius | outline, ragged?, beach, cliffs?, shelf?, floor, seed?', does: 'ends the land at a shore: inside it the last `beach` units run down to the sea (ground higher than `cliffs` above the sea stays as a cliff), outside a `shelf` [width, depth] of shallows and then the bed at `floor` below the sea' },
    smooth: { fields: 'radius?, passes?', does: 'rounds the ground off: every crease and corner narrower than `radius` world units is worn to a curve that wide (default three samples), `passes` times over. Painted and stylised country is round: run it after what cuts hard edges (plateau, terrace, river, road, pillars), wide over meadow and hills, and with a `where` (gentler than 40 degrees, say) to leave the cliffs their faces' },
    erode: { fields: 'amount, seed?', does: 'lets rain wear it: gullies down the slopes and silt in the hollows, 0..1' },
    valley: { fields: 'path, width, depth?, floor?, walls?, seed?', does: 'cuts a dry valley or a canyon along [x, z, y?] points: a floor `floor` wide at the heights given (or `depth` under the ground as it lay), then walls rising `walls` per unit out; 3 and more is a slot canyon, 0.4 a broad dale' },
    crater: { fields: 'at, radius, depth, rim?', does: 'a bowl with a raised rim: a crater, a caldera on a hill, a sinkhole with rim 0' },
    dunes: { fields: 'height, length, heading?, seed?', does: 'lays dunes `length` from crest to crest, their gentle side to the wind from `heading` degrees and their steep side away' },
    talus: { fields: 'angle', does: 'brings ground steeper than `angle` degrees down to it: the top of a face is cut back and its foot filled, as rock that falls gathers below, so a wall becomes a scree slope a character can climb. With a `where` it tames one place and leaves the cliffs elsewhere' },
    sculpt: { fields: 'strokes', does: 'brush strokes where one particular place wants a hand: { brush: raise | lower | smooth | flatten | roughen, points: [[x, z], ...], radius, by?, height?, soft? } in order' },
    stream: { fields: 'name?, from, width, grow?, depth?, valley?, seed?', does: 'lets water find its own way down from `from` to the sea, a lake or the edge, cutting its bed as a river does and widening by `grow` per unit run; where a hollow stops it, it cuts through. The reply gives the line it took' },
    image: { fields: 'file, low, high, at?, size?, blend?', does: 'lays a heightmap picture from the project over the land (or over `size` about `at`), black at `low` and white at `high`: set, add, max or min with what is there' },
    clamp: { fields: 'min?, max?', does: 'holds the ground between two heights' },
};

/** The ops as the tool's description lists them. */
export function describeLandOps(): string {
    return (Object.entries(LAND_OPS) as [LandOp, { fields: string; does: string }][]).map(([op, d]) => `${op}(${d.fields}): ${d.does}`).join('; ');
}

const RESOLUTIONS = [129, 257, 513, 1025, 2049, 4097];

/** A source that cannot be built: which step, and what is wrong with it. */
export class LandBuildError extends Error {
    constructor(message: string, readonly stepIndex: number | null = null, readonly stepId: string | null = null, readonly op: string | null = null) {
        super(message);
    }
}

const isPoint = (v: unknown, least = 2): boolean => Array.isArray(v) && v.length >= least && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Checks the shape of a land source, naming what is wrong in the terms it was written in. */
export function validateLandSource(raw: unknown): LandSource {
    if (!raw || typeof raw !== 'object') throw new LandBuildError('a land source is an object: { version: 1, size, resolution, steps }');
    const s = raw as Partial<LandSource>;
    if (s.version !== 1) throw new LandBuildError('version must be 1');
    if (!isPoint(s.size) || !(s.size![0] > 0) || !(s.size![1] > 0)) throw new LandBuildError('size is [along x, along z] in world units, both above 0');
    if (s.center !== undefined && !isPoint(s.center)) throw new LandBuildError('center is [x, z]');
    if (!RESOLUTIONS.includes(s.resolution as number)) throw new LandBuildError(`resolution ${String(s.resolution)} must be one of ${RESOLUTIONS.join(', ')}`);
    if (!Array.isArray(s.steps) || s.steps.length === 0) throw new LandBuildError('steps must hold at least one step');
    s.steps.forEach((step, i) => {
        const at = (message: string): LandBuildError => new LandBuildError(message, i, (step as { id?: string })?.id ?? null, (step as { op?: string })?.op ?? null);
        if (!step || typeof step !== 'object') throw at(`step ${i} is not an object`);
        if (!(step.op in LAND_OPS)) throw at(`step ${i} has no op "${String((step as { op?: unknown }).op)}"; there are ${Object.keys(LAND_OPS).join(', ')}`);
        if ((step.op === 'river' || step.op === 'road' || step.op === 'ridge' || step.op === 'valley') && (!Array.isArray(step.path) || step.path.length < 2 || !step.path.every((p) => isPoint(p)))) {
            throw at(`${step.op} wants a path of at least two [x, z] points`);
        }
    });
    const names = new Set<string>();
    for (const layer of s.layers ?? []) {
        if (!layer || typeof layer.name !== 'string' || !layer.name) throw new LandBuildError('every layer has a name');
        if (names.has(layer.name)) throw new LandBuildError(`two layers are named "${layer.name}"`);
        names.add(layer.name);
    }
    if ((s.layers?.length ?? 0) > 8) throw new LandBuildError(`a ground draws 8 layers at most; this names ${s.layers!.length}`);
    for (const map of s.maps ?? []) {
        if (!map || typeof map.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(map.name)) throw new LandBuildError('every map has a name of lower-case letters, digits and dashes: it names a file');
    }
    return s as LandSource;
}

export type LandEdit =
    | { op: 'set'; step: number | string; fields: Record<string, unknown> }
    | { op: 'insert'; step: LandStep; before?: number | string; after?: number | string }
    | { op: 'remove'; step: number | string }
    | { op: 'settings'; fields: Partial<Pick<LandSource, 'size' | 'center' | 'resolution' | 'sea' | 'layers' | 'maps'>> };

/** A source with edits applied, in order: what land_edit does. A step is named by its id or its index. */
export function applyLandEdits(source: LandSource, edits: readonly LandEdit[]): LandSource {
    const out: LandSource = { ...source, steps: source.steps.map((s) => ({ ...s })) };
    const find = (ref: number | string): number => {
        const i = typeof ref === 'number' ? ref : out.steps.findIndex((s) => s.id === ref);
        if (!Number.isInteger(i) || i < 0 || i >= out.steps.length) throw new LandBuildError(`there is no step ${JSON.stringify(ref)}; there are ${out.steps.length}${out.steps.some((s) => s.id) ? ` (ids: ${out.steps.map((s) => s.id).filter(Boolean).join(', ')})` : ''}`);
        return i;
    };
    for (const edit of edits) {
        if (edit.op === 'set') {
            const i = find(edit.step);
            const next = { ...out.steps[i] } as Record<string, unknown>;
            for (const [key, value] of Object.entries(edit.fields)) {
                if (value === null) delete next[key];
                else next[key] = value;
            }
            out.steps[i] = next as unknown as LandStep;
        } else if (edit.op === 'insert') {
            const at = edit.before !== undefined ? find(edit.before) : edit.after !== undefined ? find(edit.after) + 1 : out.steps.length;
            out.steps.splice(at, 0, edit.step);
        } else if (edit.op === 'remove') {
            out.steps.splice(find(edit.step), 1);
        } else if (edit.op === 'settings') {
            for (const [key, value] of Object.entries(edit.fields)) {
                if (value === null) delete (out as unknown as Record<string, unknown>)[key];
                else (out as unknown as Record<string, unknown>)[key] = value;
            }
        } else {
            throw new LandBuildError(`an edit's op is set, insert, remove or settings, not "${String((edit as { op?: unknown }).op)}"`);
        }
    }
    return out;
}
