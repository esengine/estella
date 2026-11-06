// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelSource.ts — `.esmodel`: a model as the steps that build it.
 *
 *        The file a person or an agent edits. The `.esmesh` beside it is what a scene
 *        draws, and it can always be made again from this. Steps rather than vertices
 *        because that is what can be changed afterwards: making a door wider is one
 *        number here, and everything built on top of the door follows it.
 *
 *        Every step is checked against the table below before anything runs. An
 *        unknown field is an error, not a thing ignored: a misspelt `widht` that
 *        builds without complaint is a shape quietly using the default.
 */
import * as ops from './modelOps';
import { organic } from './organic';
import { booleanOp } from './booleans';
import { uvStep } from './modelUv';
import { lathe, loft } from './surfaces';
import { subdivide } from './subdivide';
import { decimate, triangleCount } from './decimate';
import { displace, DISPLACE_PATTERNS } from './displace';
import { stain } from './stain';
import { checkAnimations, checkController, checkRig, checkShapes, type AnimationSource, type ControllerSource, type RigSource, type ShapeSource } from './rig';
import { compact, type Face, type FaceSelector, type PolyMesh, type Vec3 } from './polyMesh';

export const MODEL_SOURCE_VERSION = 1;
export const MODEL_SOURCE_EXT = '.esmodel';

export interface ModelStep {
    /** What later edits call this step. Optional, and unique when given. */
    id?: string;
    op: string;
    [param: string]: unknown;
}

export interface ModelSource {
    version: number;
    /** Faces meeting flatter than this (degrees) share a smooth normal; 0 draws every face flat. Default 30. */
    smoothAngle?: number;
    /** World units one texture repeat covers. Default 1. */
    uvScale?: number;
    /** Lay the base UV out so no two triangles share texels: for a texture painted for this one model, where tiling is not wanted. */
    uvAtlas?: boolean;
    /** Carries a denser state of the steps onto the final surface as a normal map. It lays the base UV out as uvAtlas does. */
    normalBake?: NormalBakeSource;
    /** Joints: the mesh is skinned to them, with weights found from the surface. */
    rig?: RigSource;
    /** Clips moving the rig's joints, each written as an `.estimeline`. */
    animations?: AnimationSource[];
    /** Shapes the mesh can blend toward: expressions, a mouth. */
    shapes?: ShapeSource[];
    /** Which clip plays when: an `.esanimator` the prefab's Animator runs. */
    controller?: ControllerSource;
    steps: ModelStep[];
}

export interface NormalBakeSource {
    /** The step whose result holds the detail. Default: what the last `decimate` started from. */
    from?: string;
    /** Pixels along a side of the map, a power of two from 64 to 4096. Default 1024. */
    size?: number;
    /** How far from the final surface to look for the dense one, in model units. Default a twentieth of the diagonal. */
    distance?: number;
    /** Also writes the dense surface's paint as a base colour map, leaving the mesh's own vertex colours white. */
    color?: boolean;
}

type Kind = 'number' | 'integer' | 'boolean' | 'string' | 'vec3' | 'number|vec3' | 'number|vec2' | 'number|numbers'
    | 'color' | 'points' | 'faces' | 'edges' | 'axis' | 'pivot' | 'parts' | 'noise' | 'sections' | 'section' | 'vec3s' | 'numbers' | 'operation' | 'uvmode' | 'number|vec2only' | 'vec2' | 'pattern' | 'near' | 'where';

interface OpSpec {
    params: Record<string, Kind>;
    required: readonly string[];
    run: (mesh: PolyMesh, params: never) => PolyMesh;
    /** One line on what it does, for the catalog a tool description quotes. */
    says: string;
}

const PLACED = { at: 'vec3', tag: 'string', color: 'color' } as const;

/** Every op a step may name. Add one here and validation, the docs line and the build all know it. */
export const MODEL_OPS: Record<string, OpSpec> = {
    box: { params: { size: 'number|vec3', ...PLACED }, required: ['size'], run: ops.box as OpSpec['run'], says: 'adds a box centred on `at`' },
    plane: { params: { size: 'number|vec2', ...PLACED }, required: ['size'], run: ops.plane as OpSpec['run'], says: 'adds a flat XZ rectangle facing up' },
    cylinder: { params: { radius: 'number', height: 'number', radiusTop: 'number', sides: 'integer', ...PLACED }, required: ['radius', 'height'], run: ops.cylinder as OpSpec['run'], says: 'adds an upright cylinder; `radiusTop` tapers it' },
    cone: { params: { radius: 'number', height: 'number', sides: 'integer', ...PLACED }, required: ['radius', 'height'], run: ops.cone as OpSpec['run'], says: 'adds an upright cone' },
    sphere: { params: { radius: 'number', rings: 'integer', sides: 'integer', ...PLACED }, required: ['radius'], run: ops.sphere as OpSpec['run'], says: 'adds a sphere' },
    prism: { params: { points: 'points', height: 'number', ...PLACED }, required: ['points', 'height'], run: ops.prism as OpSpec['run'], says: 'stands a floor plan of [x, z] points up to `height`' },
    lathe: { params: { profile: 'points', sides: 'integer', arc: 'number', closed: 'boolean', curve: 'integer', axis: 'axis', ...PLACED }, required: ['profile'], run: lathe as unknown as OpSpec['run'], says: 'turns a half-outline of [distance from axis, height] round an axis: a vase, a glass, a column' },
    loft: { params: { sections: 'sections', path: 'vec3s', section: 'section', scales: 'numbers', sides: 'integer', closed: 'boolean', curve: 'integer', ...PLACED }, required: [], run: loft as unknown as OpSpec['run'], says: 'joins cross-sections along a path: a pipe, a handle, a bottle, a hull' },
    organic: { params: { parts: 'parts', resolution: 'integer', blend: 'number', noise: 'noise', at: 'vec3', tag: 'string', color: 'color' }, required: ['parts'], run: organic as unknown as OpSpec['run'], says: 'adds one continuous skin over a body of parts that melt into each other' },
    transform: { params: { faces: 'faces', translate: 'vec3', rotate: 'vec3', scale: 'number|vec3', pivot: 'pivot' }, required: [], run: ops.transform as OpSpec['run'], says: 'moves the vertices of the faces (default all): scaling a top face in makes a roof' },
    array: { params: { faces: 'faces', count: 'integer', offset: 'vec3', rotate: 'vec3', pivot: 'pivot', tag: 'string' }, required: ['count'], run: ops.array as OpSpec['run'], says: 'repeats the faces, `count` including the original' },
    mirror: { params: { faces: 'faces', axis: 'axis', at: 'number', keep: 'boolean', tag: 'string' }, required: ['axis'], run: ops.mirror as OpSpec['run'], says: 'adds a reflection across `axis` = `at`' },
    extrude: { params: { faces: 'faces', distance: 'number', direction: 'vec3', individual: 'boolean', tag: 'string', sideTag: 'string' }, required: ['faces', 'distance'], run: ops.extrude as OpSpec['run'], says: 'pushes faces out along their normals, walls joining them to where they were; negative recesses' },
    inset: { params: { faces: 'faces', amount: 'number', tag: 'string' }, required: ['faces', 'amount'], run: ops.inset as OpSpec['run'], says: 'adds a smaller copy inside each face; `tag` names that copy' },
    bevel: { params: { edges: 'edges', width: 'number', round: 'integer', tag: 'string' }, required: ['edges', 'width'], run: ops.bevel as OpSpec['run'], says: 'chamfers edges, mitring where they meet; `round` 1..3 rounds them off' },
    slice: { params: { faces: 'faces', axis: 'axis', at: 'number|numbers' }, required: ['axis', 'at'], run: ops.slice as OpSpec['run'], says: 'cuts faces across planes, making the seams a window sits between' },
    boolean: { params: { operation: 'operation', with: 'faces', from: 'faces', keep: 'boolean', tag: 'string', color: 'color' }, required: ['operation', 'with'], run: booleanOp as unknown as OpSpec['run'], says: 'cuts or joins closed solids: subtract `with` from `from` makes a real hole' },
    subdivide: { params: { faces: 'faces', levels: 'integer', crease: 'number' }, required: [], run: subdivide as unknown as OpSpec['run'], says: 'rounds whole shells into smooth surfaces, keeping edges sharper than `crease` degrees' },
    displace: { params: { faces: 'faces', near: 'near', pattern: 'pattern', amplitude: 'number', scale: 'number', octaves: 'integer', seed: 'integer', stretch: 'vec3', warp: 'number', width: 'number', axis: 'axis', mirror: 'axis', detail: 'number' }, required: ['pattern', 'amplitude', 'scale'], run: ((mesh: PolyMesh, params: never) => displace(mesh, params)) as OpSpec['run'], says: 'pushes fine detail out of the surface along its normal, splitting faces as far as the pattern needs: bumps, wrinkles, cracks, scales, pores, ribs, weave or scratches' },
    stain: { params: { faces: 'faces', near: 'near', hard: 'boolean', color: 'color', amount: 'number', pattern: 'pattern', scale: 'number', octaves: 'integer', seed: 'integer', stretch: 'vec3', warp: 'number', width: 'number', axis: 'axis', mirror: 'axis', threshold: 'number', softness: 'number', where: 'where', reach: 'number', facing: 'vec3', detail: 'number' }, required: ['color'], run: ((mesh: PolyMesh, params: never) => stain(mesh, params)) as OpSpec['run'], says: 'lays colour over the surface by a pattern, by shape (`where`: cavity for dirt in what is sunken, edges for wear on what stands out), by which way it faces, or around a spot: pupils, moss, grime' },
    decimate: { params: { from: 'string', faces: 'faces', ratio: 'number', triangles: 'integer', error: 'number' }, required: [], run: decimate as unknown as OpSpec['run'], says: 'leaves fewer triangles over the same surface: `ratio` to keep or `triangles` to end with, stopping sooner if the surface would move more than `error` (default 0.02) of its size; `from` thins the surface as it stood after that step, before its fine detail' },
    uv: { params: { faces: 'faces', mode: 'uvmode', axis: 'string', at: 'vec3', scale: 'number|vec2only', repeat: 'number|vec2only', offset: 'vec2', rotate: 'number' }, required: ['mode'], run: uvStep as unknown as OpSpec['run'], says: 'sets how faces take a texture: box, planar, cylinder or sphere' },
    delete: { params: { faces: 'faces' }, required: ['faces'], run: ops.deleteFaces as OpSpec['run'], says: 'removes faces, leaving a hole' },
    paint: { params: { faces: 'faces', color: 'color' }, required: ['faces', 'color'], run: ops.paint as OpSpec['run'], says: 'sets vertex colour: linear [r, g, b] in 0..1, multiplied into the material' },
    tag: { params: { faces: 'faces', tag: 'string' }, required: ['faces', 'tag'], run: ops.tagFaces as OpSpec['run'], says: 'names faces for later steps' },
    weld: { params: { distance: 'number' }, required: [], run: ops.weld as OpSpec['run'], says: 'merges coincident vertices and removes the back-to-back faces that leaves' },
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNums = (v: unknown, n?: number): boolean => Array.isArray(v) && (n === undefined || v.length === n) && v.every(isNum);

const FACE_KEYS = new Set(['tag', 'facing', 'tolerance', 'within', 'extreme', 'any', 'not']);
const EDGE_KEYS = new Set(['of', 'between', 'along', 'within', 'sharp']);
const AXIS_NAMES = new Set(['+x', '-x', '+y', '-y', '+z', '-z']);

function checkBox(box: unknown): string | null {
    if (typeof box !== 'object' || box === null) return 'must be { min?, max? }';
    for (const [key, value] of Object.entries(box)) {
        if (key !== 'min' && key !== 'max') return `has an unknown key "${key}"; it takes min and max`;
        if (!Array.isArray(value) || value.length !== 3 || !value.every((v) => v === null || isNum(v))) return `${key} must be [x, y, z], null for an open axis`;
    }
    return null;
}

/** What is wrong with a face selector, or null. */
function checkFaces(sel: unknown): string | null {
    if (typeof sel === 'string') return null;
    if (typeof sel !== 'object' || sel === null || Array.isArray(sel)) return 'must be "all", an axis like "+y", a tag, or an object';
    const s = sel as Record<string, unknown>;
    for (const key of Object.keys(s)) if (!FACE_KEYS.has(key)) return `has an unknown key "${key}"; it takes ${[...FACE_KEYS].join(', ')}`;
    if (s.facing !== undefined && !(typeof s.facing === 'string' && AXIS_NAMES.has(s.facing)) && !isNums(s.facing, 3)) return 'facing must be an axis like "+y" or a direction [x, y, z]';
    if (s.extreme !== undefined && !(typeof s.extreme === 'string' && AXIS_NAMES.has(s.extreme))) return 'extreme must be an axis like "+y"';
    if (s.tolerance !== undefined && !isNum(s.tolerance)) return 'tolerance must be degrees';
    if (s.tag !== undefined && typeof s.tag !== 'string' && !(Array.isArray(s.tag) && s.tag.every((t) => typeof t === 'string'))) return 'tag must be a string or strings';
    if (s.within !== undefined) { const bad = checkBox(s.within); if (bad) return `within ${bad}`; }
    if (s.any !== undefined) {
        if (!Array.isArray(s.any)) return 'any must be an array of selectors';
        for (const part of s.any) { const bad = checkFaces(part); if (bad) return `any: ${bad}`; }
    }
    if (s.not !== undefined) { const bad = checkFaces(s.not); if (bad) return `not: ${bad}`; }
    return null;
}

function checkEdges(sel: unknown): string | null {
    if (sel === 'all') return null;
    if (typeof sel !== 'object' || sel === null || Array.isArray(sel)) return 'must be "all" or an object';
    const s = sel as Record<string, unknown>;
    for (const key of Object.keys(s)) if (!EDGE_KEYS.has(key)) return `has an unknown key "${key}"; it takes ${[...EDGE_KEYS].join(', ')}`;
    if (s.of !== undefined) { const bad = checkFaces(s.of); if (bad) return `of: ${bad}`; }
    if (s.between !== undefined) {
        if (!Array.isArray(s.between) || s.between.length !== 2) return 'between must be two face selectors';
        for (const part of s.between) { const bad = checkFaces(part); if (bad) return `between: ${bad}`; }
    }
    if (s.along !== undefined && !['x', 'y', 'z'].includes(s.along as string)) return 'along must be x, y or z';
    if (s.sharp !== undefined && !isNum(s.sharp)) return 'sharp must be degrees';
    if (s.within !== undefined) { const bad = checkBox(s.within); if (bad) return `within ${bad}`; }
    return null;
}

const NOISE_KEYS = new Set(['amplitude', 'scale', 'octaves', 'seed']);
function checkNoise(v: unknown): string | null {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'must be { amplitude, scale, octaves?, seed? }';
    const n = v as Record<string, unknown>;
    for (const key of Object.keys(n)) if (!NOISE_KEYS.has(key)) return `has an unknown key "${key}"; it takes ${[...NOISE_KEYS].join(', ')}`;
    if (!isNum(n.amplitude) || !isNum(n.scale) || n.scale <= 0) return 'needs a number amplitude and a positive scale';
    if (n.octaves !== undefined && !(Number.isInteger(n.octaves) && (n.octaves as number) >= 1 && (n.octaves as number) <= 6)) return 'octaves must be 1..6';
    if (n.seed !== undefined && !Number.isInteger(n.seed)) return 'seed must be a whole number';
    return null;
}

const PART_FIELDS: Record<string, (v: unknown) => string | null> = {
    shape: (v) => (['sphere', 'ellipsoid', 'box', 'torus', 'chain'].includes(v as string) ? null : 'must be sphere, ellipsoid, box, torus or chain'),
    tag: (v) => (typeof v === 'string' ? null : 'must be a string'),
    at: (v) => (isNums(v, 3) ? null : 'must be [x, y, z]'),
    rotate: (v) => (isNums(v, 3) ? null : 'must be [x, y, z] degrees'),
    radius: (v) => (isNum(v) ? null : 'must be a number'),
    radii: (v) => (isNums(v, 3) ? null : 'must be [x, y, z]'),
    size: (v) => (isNums(v, 3) ? null : 'must be [x, y, z]'),
    rounding: (v) => (isNum(v) ? null : 'must be a number'),
    tube: (v) => (isNum(v) ? null : 'must be a number'),
    points: (v) => (Array.isArray(v) && v.every((q) => isNums(q, 4)) ? null : 'must be an array of [x, y, z, radius]'),
    blend: (v) => (isNum(v) ? null : 'must be a number'),
    subtract: (v) => (typeof v === 'boolean' ? null : 'must be true or false'),
    mirror: (v) => (v === 'x' || v === 'y' || v === 'z' ? null : 'must be x, y or z'),
    color: (v) => (isNums(v) ? null : 'must be [r, g, b] or [r, g, b, a]'),
    noise: checkNoise,
};

const SECTION_FIELDS: Record<string, (v: unknown) => string | null> = {
    at: (v) => (isNums(v, 3) ? null : 'must be [x, y, z]'),
    radius: (v) => (isNum(v) ? null : 'must be a number'),
    radii: (v) => (isNums(v, 2) ? null : 'must be [across, up]'),
    size: (v) => (isNums(v, 2) ? null : 'must be [across, up]'),
    points: (v) => (Array.isArray(v) && v.every((q) => isNums(q, 2)) ? null : 'must be an array of [across, up]'),
    twist: (v) => (isNum(v) ? null : 'must be degrees'),
    scale: (v) => (isNum(v) ? null : 'must be a number'),
};

function checkSection(v: unknown): string | null {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'must be an object';
    for (const [key, value] of Object.entries(v)) {
        const check = SECTION_FIELDS[key];
        if (!check) return `has an unknown field "${key}"; a section takes ${Object.keys(SECTION_FIELDS).join(', ')}`;
        const bad = check(value);
        if (bad) return `.${key} ${bad}`;
    }
    return null;
}

function checkSections(v: unknown): string | null {
    if (!Array.isArray(v)) return 'must be an array of sections';
    for (let i = 0; i < v.length; i++) {
        const bad = checkSection(v[i]);
        if (bad) return `[${i}] ${bad}`;
    }
    return null;
}

function checkParts(v: unknown): string | null {
    if (!Array.isArray(v) || v.length === 0) return 'must be a non-empty array of parts';
    for (let i = 0; i < v.length; i++) {
        const part = v[i] as Record<string, unknown> | null;
        if (typeof part !== 'object' || part === null) return `[${i}] must be an object`;
        if (part.shape === undefined) return `[${i}] needs a shape`;
        for (const [key, value] of Object.entries(part)) {
            const check = PART_FIELDS[key];
            if (!check) return `[${i}] has an unknown field "${key}"; a part takes ${Object.keys(PART_FIELDS).join(', ')}`;
            const bad = check(value);
            if (bad) return `[${i}].${key} ${bad}`;
        }
    }
    return null;
}

const KIND_CHECK: Record<Kind, (v: unknown) => string | null> = {
    number: (v) => (isNum(v) ? null : 'must be a number'),
    integer: (v) => (Number.isInteger(v) ? null : 'must be a whole number'),
    boolean: (v) => (typeof v === 'boolean' ? null : 'must be true or false'),
    string: (v) => (typeof v === 'string' ? null : 'must be a string'),
    vec3: (v) => (isNums(v, 3) ? null : 'must be [x, y, z]'),
    'number|vec3': (v) => (isNum(v) || isNums(v, 3) ? null : 'must be a number or [x, y, z]'),
    'number|vec2': (v) => (isNum(v) || isNums(v, 2) ? null : 'must be a number or [x, z]'),
    'number|numbers': (v) => (isNum(v) || isNums(v) ? null : 'must be a number or an array of them'),
    color: (v) => (isNums(v) ? null : 'must be [r, g, b] or [r, g, b, a]'),
    points: (v) => (Array.isArray(v) && v.every((q) => isNums(q, 2)) ? null : 'must be an array of [x, z]'),
    faces: checkFaces,
    edges: checkEdges,
    axis: (v) => (v === 'x' || v === 'y' || v === 'z' ? null : 'must be x, y or z'),
    parts: checkParts,
    sections: checkSections,
    section: checkSection,
    vec3s: (v) => (Array.isArray(v) && v.every((q) => isNums(q, 3)) ? null : 'must be an array of [x, y, z]'),
    numbers: (v) => (isNums(v) ? null : 'must be an array of numbers'),
    operation: (v) => (v === 'subtract' || v === 'union' || v === 'intersect' ? null : 'must be subtract, union or intersect'),
    uvmode: (v) => (['box', 'planar', 'cylinder', 'sphere'].includes(v as string) ? null : 'must be box, planar, cylinder or sphere'),
    'number|vec2only': (v) => (isNum(v) || isNums(v, 2) ? null : 'must be a number or [u, v]'),
    vec2: (v) => (isNums(v, 2) ? null : 'must be [u, v]'),
    pattern: (v) => (DISPLACE_PATTERNS.includes(v as never) ? null : `must be one of ${DISPLACE_PATTERNS.join(', ')}`),
    where: (v) => (v === 'cavity' || v === 'edges' ? null : 'must be cavity or edges'),
    near: (v) => {
        const n = v as { at?: unknown; radius?: unknown } | null;
        return typeof n === 'object' && n !== null && isNums(n.at, 3) && isNum(n.radius) && Object.keys(n).every((k) => k === 'at' || k === 'radius') ? null : 'must be { at: [x, y, z], radius }';
    },
    noise: checkNoise,
    pivot: (v) => (v === 'center' || v === 'base' || isNums(v, 3) ? null : 'must be "center", "base" or [x, y, z]'),
};

export class ModelBuildError extends Error {
    constructor(message: string, readonly stepIndex: number | null, readonly stepId: string | null, readonly op: string | null) {
        super(message);
        this.name = 'ModelBuildError';
    }
}

function checkNormalBake(v: unknown, steps: readonly Partial<ModelStep>[]): string | null {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'must be { from?, size?, distance?, color? }';
    const bake = v as Record<string, unknown>;
    for (const key of Object.keys(bake)) if (!['from', 'size', 'distance', 'color'].includes(key)) return `has an unknown field "${key}"; it takes from, size, distance, color`;
    const { size, distance, from } = bake;
    if (size !== undefined && !(Number.isInteger(size) && (size as number) >= 64 && (size as number) <= 4096 && ((size as number) & ((size as number) - 1)) === 0)) return 'size must be a power of two, 64..4096';
    if (distance !== undefined && !(isNum(distance) && distance > 0)) return 'distance must be a positive number';
    if (bake.color !== undefined && typeof bake.color !== 'boolean') return 'color must be true or false';
    if (from !== undefined) {
        if (typeof from !== 'string') return 'from must be a step id';
        if (!steps.some((s) => s?.id === from)) return `from "${from}" is no step's id`;
        return null;
    }
    const last = steps.map((s) => s?.op).lastIndexOf('decimate');
    if (last < 0) return 'needs a surface to carry: a decimate step, or `from` naming a step';
    return last === 0 ? 'has nothing to carry: the decimate is the first step' : null;
}

const stepLabel = (step: Partial<ModelStep> | null, index: number): string =>
    `step ${index}${step?.id ? ` "${step.id}"` : ''}${step?.op ? ` (${step.op})` : ''}`;

/** The source if it is well formed; otherwise throws, naming the step and the field. */
export function validateModelSource(raw: unknown): ModelSource {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ModelBuildError('a model source must be an object with `steps`', null, null, null);
    const source = raw as Record<string, unknown>;
    for (const key of Object.keys(source)) {
        if (!['version', 'smoothAngle', 'uvScale', 'uvAtlas', 'normalBake', 'rig', 'shapes', 'animations', 'controller', 'steps'].includes(key)) {
            throw new ModelBuildError(`unknown field "${key}"; a model source has version, smoothAngle, uvScale, uvAtlas, normalBake, rig, shapes, animations, controller, steps`, null, null, null);
        }
    }
    if (source.version !== undefined && source.version !== MODEL_SOURCE_VERSION) {
        throw new ModelBuildError(`version ${String(source.version)} is not one this editor reads (${MODEL_SOURCE_VERSION})`, null, null, null);
    }
    if (source.smoothAngle !== undefined && !(isNum(source.smoothAngle) && source.smoothAngle >= 0 && source.smoothAngle <= 180)) {
        throw new ModelBuildError('smoothAngle must be degrees, 0..180', null, null, null);
    }
    if (source.uvScale !== undefined && !(isNum(source.uvScale) && source.uvScale > 0)) {
        throw new ModelBuildError('uvScale must be a positive number', null, null, null);
    }
    if (source.uvAtlas !== undefined && typeof source.uvAtlas !== 'boolean') {
        throw new ModelBuildError('uvAtlas must be true or false', null, null, null);
    }
    if (source.rig !== undefined) {
        const bad = checkRig(source.rig);
        if (bad) throw new ModelBuildError(bad, null, null, null);
        if (source.uvAtlas) throw new ModelBuildError('uvAtlas lays out with the lightmap unwrap, which a rigged mesh does not have: bones move it. Use uv steps', null, null, null);
    }
    if (source.shapes !== undefined) {
        const bad = checkShapes(source.shapes);
        if (bad) throw new ModelBuildError(bad, null, null, null);
        if (source.uvAtlas) throw new ModelBuildError('uvAtlas lays out with the lightmap unwrap, which a morphing mesh does not have. Use uv steps', null, null, null);
    }
    if (source.animations !== undefined) {
        const bad = checkAnimations(source.animations, source.rig, source.shapes);
        if (bad) throw new ModelBuildError(bad, null, null, null);
    }
    if (source.controller !== undefined) {
        const bad = checkController(source.controller, source.animations, source.rig as RigSource | undefined);
        if (bad) throw new ModelBuildError(bad, null, null, null);
    }
    if (!Array.isArray(source.steps)) throw new ModelBuildError('`steps` must be an array', null, null, null);
    if (source.normalBake !== undefined) {
        const bad = checkNormalBake(source.normalBake, source.steps as Partial<ModelStep>[]);
        if (bad) throw new ModelBuildError(`normalBake ${bad}`, null, null, null);
    }
    const ids = new Set<string>();
    source.steps.forEach((step: Partial<ModelStep> | null, index: number) => {
        const refuse = (what: string): never => {
            throw new ModelBuildError(`${stepLabel(step, index)}: ${what}`, index, step?.id ?? null, step?.op ?? null);
        };
        if (typeof step !== 'object' || step === null) return refuse('must be an object');
        if (typeof step.id === 'string') {
            if (ids.has(step.id)) refuse(`the id "${step.id}" is already used by an earlier step`);
            ids.add(step.id);
        } else if (step.id !== undefined) refuse('id must be a string');
        const spec = typeof step.op === 'string' ? MODEL_OPS[step.op] : undefined;
        if (!spec) return refuse(`unknown op ${JSON.stringify(step.op)}; there are ${Object.keys(MODEL_OPS).join(', ')}`);
        for (const [key, value] of Object.entries(step)) {
            if (key === 'id' || key === 'op') continue;
            const kind = spec.params[key];
            if (!kind) refuse(`unknown field "${key}"; ${step.op} takes ${Object.keys(spec.params).join(', ')}`);
            const bad = KIND_CHECK[kind!](value);
            if (bad) refuse(`${key} ${bad}`);
        }
        for (const need of spec.required) if (step[need] === undefined) refuse(`${need} is required`);
        if (step.op === 'decimate' && step.from !== undefined && !(source.steps as Partial<ModelStep>[]).slice(0, index).some((s) => s?.id === step.from)) refuse(`from "${String(step.from)}" is no earlier step's id`);
        return undefined;
    });
    return { version: MODEL_SOURCE_VERSION, ...(source as unknown as Omit<ModelSource, 'version'>) };
}

export interface StepReport {
    index: number;
    id?: string;
    op: string;
    /** Faces in the mesh after it ran. */
    faces: number;
    /** A decimate: triangles it was given, and triangles it left. */
    trianglesBefore?: number;
    trianglesAfter?: number;
}

export interface ModelBuild {
    mesh: PolyMesh;
    steps: StepReport[];
    /** The surface `normalBake` carries, as the steps stood then. */
    high?: PolyMesh;
    /** What steps wanted said, in their order. */
    notes: string[];
}

/** Runs the steps in order. A step that cannot run throws a {@link ModelBuildError} naming it. */
export function buildPolyMesh(source: ModelSource): ModelBuild {
    let mesh: PolyMesh = { positions: [], faces: [] };
    const steps: StepReport[] = [];
    const bake = source.normalBake;
    // After this step, the surface is the one to carry: the one named, or the one before the last decimate.
    const highAfter = !bake ? -2 : bake.from !== undefined ? source.steps.findIndex((s) => s.id === bake.from) : source.steps.map((s) => s.op).lastIndexOf('decimate') - 1;
    let high: PolyMesh | undefined;
    const notes: string[] = [];
    // The states a later decimate starts from instead of the one it finds, and only those: a dense model is a lot to keep.
    const wanted = new Set(source.steps.flatMap((s) => (s.op === 'decimate' && typeof s.from === 'string' ? [s.from] : [])));
    const kept = new Map<string, PolyMesh>();
    source.steps.forEach((step, index) => {
        const { id, op, ...params } = step;
        const { from, ...rest } = params as { from?: string };
        const input = op === 'decimate' && from !== undefined ? kept.get(from)! : mesh;
        const before = op === 'decimate' ? triangleCount(input) : 0;
        try {
            mesh = MODEL_OPS[op]!.run(input, (op === 'decimate' ? rest : params) as never);
        } catch (e) {
            throw new ModelBuildError(`${stepLabel(step, index)}: ${e instanceof Error ? e.message : String(e)}`, index, id ?? null, op);
        }
        if (mesh.notes) {
            for (const note of mesh.notes) notes.push(`${stepLabel(step, index)}: ${note}`);
            mesh = { positions: mesh.positions, faces: mesh.faces };
        }
        steps.push({ index, ...(id ? { id } : {}), op, faces: mesh.faces.length, ...(op === 'decimate' ? { trianglesBefore: before, trianglesAfter: triangleCount(mesh) } : {}) });
        if (index === highAfter) high = compact(mesh);
        if (id && wanted.has(id)) kept.set(id, mesh);
    });
    return { mesh: compact(mesh), steps, notes, ...(high ? { high } : {}) };
}

// ---- Edits: changing a source without restating it ------------------------------

export type ModelEdit =
    | { op: 'set'; step: string | number; fields: Record<string, unknown> }
    | { op: 'insert'; step: ModelStep; before?: string | number; after?: string | number }
    | { op: 'remove'; step: string | number }
    | { op: 'settings'; fields: Pick<ModelSource, 'smoothAngle' | 'uvScale' | 'uvAtlas' | 'normalBake' | 'rig' | 'shapes' | 'animations' | 'controller'> };

function indexOfStep(source: ModelSource, ref: string | number): number {
    const i = typeof ref === 'number' ? ref : source.steps.findIndex((s) => s.id === ref);
    if (i < 0 || i >= source.steps.length || !Number.isInteger(i)) {
        const ids = source.steps.map((s) => s.id).filter(Boolean);
        throw new ModelBuildError(`no step ${JSON.stringify(ref)}; ${source.steps.length} steps, ids: ${ids.join(', ') || '(none)'}`, null, null, null);
    }
    return i;
}

/** The source with @p edits applied, in order. A `null` field in `set` removes it. Refuses without changing anything. */
export function applyModelEdits(source: ModelSource, edits: readonly ModelEdit[]): ModelSource {
    const next: ModelSource = { ...source, steps: source.steps.map((s) => ({ ...s })) };
    for (const edit of edits) {
        switch (edit?.op) {
            case 'set': {
                const i = indexOfStep(next, edit.step);
                const step = { ...next.steps[i]! } as Record<string, unknown>;
                for (const [key, value] of Object.entries(edit.fields ?? {})) {
                    if (value === null) delete step[key];
                    else step[key] = value;
                }
                next.steps[i] = step as ModelStep;
                break;
            }
            case 'insert': {
                const at = edit.before !== undefined ? indexOfStep(next, edit.before)
                    : edit.after !== undefined ? indexOfStep(next, edit.after) + 1 : next.steps.length;
                next.steps.splice(at, 0, edit.step);
                break;
            }
            case 'remove':
                next.steps.splice(indexOfStep(next, edit.step), 1);
                break;
            case 'settings':
                // A null removes, as it does in `set`.
                for (const [key, value] of Object.entries(edit.fields ?? {})) {
                    if (value === null) delete (next as unknown as Record<string, unknown>)[key];
                    else (next as unknown as Record<string, unknown>)[key] = value;
                }
                break;
            default:
                throw new ModelBuildError(`unknown edit ${JSON.stringify((edit as { op?: unknown })?.op)}; there are set, insert, remove, settings`, null, null, null);
        }
    }
    return validateModelSource(next);
}

/** The op vocabulary as text, for what a tool tells its caller. */
export const describeModelOps = (): string => Object.entries(MODEL_OPS)
    .map(([name, spec]) => `${name}(${Object.keys(spec.params).map((p) => (spec.required.includes(p) ? p : `${p}?`)).join(', ')}): ${spec.says}`)
    .join('; ');

export type { Face, FaceSelector, PolyMesh, Vec3 };
