// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  imageSource.ts — `.esimage`: a picture as a list of layers, what a model writes and edits, and what is wrong with one.
 */
import { parsePath } from './imageRaster';

export const IMAGE_SOURCE_EXT = '.esimage';
export const IMAGE_SOURCE_VERSION = 1;
export const MAX_IMAGE_SIZE = 2048;

export type ImageFill = string
    | { type: 'linear'; from: readonly [number, number]; to: readonly [number, number]; stops: readonly (readonly [number, string])[] }
    | { type: 'radial'; at: readonly [number, number]; radius: number; stops: readonly (readonly [number, string])[] }
    /** The same picture on every machine: it comes from `seed` and never from a random number. */
    | { type: 'noise'; scale?: number; octaves?: number; seed?: number; stops: readonly (readonly [number, string])[] }
    /** By which way a figure's surface faces: 1 toward the light, 0.5 side on, 0 away. So light turns the form and does not sit on its edge. */
    | { type: 'form'; figure: string; light?: readonly number[]; stops: readonly (readonly [number, string])[] }
    /** The colour of an `image` layer at each place. */
    | { type: 'image'; image: string }
    /** Marks in rows and columns: windows, tiles, grilles. On four corners it lies in perspective. */
    | {
        type: 'grid';
        /** A cell's size in pixels, or with `quad` how many columns and rows there are. */
        cell?: readonly [number, number];
        cells?: readonly [number, number];
        /** Corners in order round: top left, top right, bottom right, bottom left. */
        quad?: readonly (readonly number[])[];
        /** The mark as a share of its cell, each 0..1. */
        mark?: readonly [number, number];
        colors: readonly string[];
        /** Between the marks; clear without it. */
        ground?: string;
        /** The share of marks that are on, 0..1, and what the rest show. */
        lit?: number;
        off?: string;
        seed?: number;
    };

export interface ImageEffect {
    type: 'shadow' | 'glow' | 'innerShadow' | 'innerGlow';
    color?: string;
    x?: number;
    y?: number;
    blur?: number;
    opacity?: number;
}

export interface ImageTransform {
    translate?: readonly [number, number];
    /** Degrees, clockwise on screen, about `origin`. */
    rotate?: number;
    scale?: number | readonly [number, number];
    /** Default the layer's middle. */
    origin?: readonly [number, number];
}

export type ImageShape = 'rect' | 'circle' | 'ellipse' | 'ring' | 'polygon' | 'line' | 'star' | 'gear' | 'path' | 'pixels' | 'paint' | 'figure' | 'image' | 'text' | 'block' | 'perspective' | 'reflect' | 'bloom' | 'repaint' | 'group';

/** How a brush lays colour. Any of these on a stroke, a sweep or a field, over what its `brush` starts from. */
export interface ImageBrushSettings {
    hardness?: number;
    opacity?: number;
    taper?: readonly [number, number];
    /** 1 round; lower is a flat brush, thin along its travel and wide across it. */
    roundness?: number;
    /** Degrees the flat of the brush is held at, which gives thick and thin as a pen does. Without it the brush turns with the stroke. */
    angle?: number;
    /** 0..1: how much the tooth of the paper breaks it up, in a texture fixed to the picture. */
    grain?: number;
    grainScale?: number;
    /** 0..1: how much the brush runs dry, in streaks along its travel. */
    dry?: number;
    /** 0..1: how much it picks up what is under it as it goes. */
    wet?: number;
    /** 0..1: pigment gathered at the edge, as watercolour dries. */
    edge?: number;
    /** Each dab this many brush radii off the line. */
    scatter?: number;
    /** The dabs as a share of the brush's size: small, and scattered, they are a spray. */
    dab?: number;
    /** Between dabs, as a share of a dab's width. */
    spacing?: number;
    /** 0..1: each dab adds this much, so paint builds where it passes, as an airbrush does, and opacity no longer caps it. */
    flow?: number;
    /** How much of the length at each end fades out, each 0..1. */
    fade?: readonly [number, number];
}

/** Named starting points, in the words a painter uses. */
export const IMAGE_BRUSHES: Readonly<Record<string, ImageBrushSettings>> = {
    ink: { hardness: 1, taper: [0.12, 0.3] },
    pen: { hardness: 1, roundness: 0.25, angle: -45 },
    pencil: { hardness: 0.6, grain: 0.35, grainScale: 1.2, opacity: 0.75 },
    charcoal: { hardness: 0.35, grain: 0.5, grainScale: 2.2, dry: 0.12, opacity: 0.95 },
    chalk: { hardness: 0.7, grain: 0.55, grainScale: 6, opacity: 0.95 },
    flat: { hardness: 0.85, roundness: 0.3, dry: 0.3 },
    oil: { hardness: 0.65, roundness: 0.55, dry: 0.22, wet: 0.55, opacity: 0.95 },
    gouache: { hardness: 0.8, roundness: 0.5, wet: 0.2, dry: 0.08, opacity: 0.95 },
    watercolor: { hardness: 0.2, wet: 0.45, edge: 0.5, opacity: 0.45, grain: 0.05, grainScale: 5 },
    marker: { hardness: 0.9, roundness: 0.45, angle: -30, opacity: 0.72 },
    airbrush: { hardness: 0, flow: 0.05 },
    spray: { hardness: 0.7, dab: 0.07, scatter: 1, spacing: 0.5, opacity: 0.9 },
    dry: { hardness: 0.75, roundness: 0.35, dry: 0.65, opacity: 0.95 },
};
const BRUSH_FIELDS = ['brush', 'roundness', 'angle', 'grain', 'grainScale', 'dry', 'wet', 'edge', 'scatter', 'dab', 'spacing', 'flow', 'fade'];

/** One movement of a brush. Replayed in order on a `paint` layer, so the same list is the same picture. */
export interface ImageStroke extends ImageBrushSettings {
    /** A named brush from IMAGE_BRUSHES, which what else is given here overrides. */
    brush?: string;
    /** Through these, smoothly; a third number is pressure, 1 by default. One point is a dab. */
    points: readonly (readonly number[])[];
    color?: string;
    /** The colour it has become by the end. */
    to?: string;
    size: number;
    /** 1 is a hard edge, 0 fades from the middle. */
    hardness?: number;
    opacity?: number;
    /** How much of the length at each end narrows to a point, each 0..1. */
    taper?: readonly [number, number];
    /** Separate hairs across its width, which meet where it narrows. */
    bristles?: number;
    /** The width of a bristle; by default what spreads them across the stroke. */
    strand?: number;
    spread?: number;
    /** How far each bristle's lightness and strength differ, 0..1. */
    vary?: number;
    /** How far a bristle wanders from its line, in pixels. */
    wobble?: number;
    seed?: number;
    /** 0..1: drags what is already on this layer along, instead of laying colour. */
    smudge?: number;
    erase?: boolean;
    blend?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'add';
}

/** Many hairs between guide lines, gathered into locks. A few words of intent, and hundreds of strokes when drawn. */
export interface ImageSweep extends ImageBrushSettings {
    type: 'sweep';
    brush?: string;
    /** Two or more lines, side by side and in order, each root to tip. */
    guides: readonly (readonly (readonly number[])[])[];
    /** Across the guides, first to last. */
    colors: readonly string[];
    count: number;
    /** What the colours have turned to by the tips. */
    tip?: string;
    /** The width of one hair. */
    size?: number;
    clumps?: number;
    /** How far hairs draw into their lock by the tips, 0..1. */
    gather?: number;
    /** The share of hairs that stray from the mass, 0..1. */
    flyaway?: number;
    vary?: number;
    wobble?: number;
    opacity?: number;
    taper?: readonly [number, number];
    seed?: number;
}

/** A region covered in strokes that follow a flow, each its colour from `tone` where it starts. */
export interface ImageField extends ImageBrushSettings {
    type: 'field';
    brush?: string;
    /** An SVG path to start strokes in, or "@id" for where an earlier layer drew; the whole picture without it. Strokes may run over its edge. */
    region?: string;
    /** Lines the strokes follow, nearest the most, or a direction in degrees clockwise from right. */
    guides?: readonly (readonly (readonly number[])[])[];
    angle?: number;
    /** Where each stroke takes its colour; left out when it smudges. */
    tone?: ImageFill;
    /** 0..1: the strokes drag what is there along the flow, and lay no colour. */
    smudge?: number;
    size: number;
    length?: number;
    /** How many times over the strokes cover the region. */
    coverage?: number;
    /** Degrees either side of the flow. */
    spread?: number;
    vary?: number;
    opacity?: number;
    hardness?: number;
    seed?: number;
}

/** The same strokes again and again along a line: feathers, scales, leaves, beads. */
export interface ImageAlong {
    type: 'along';
    line: readonly (readonly number[])[];
    count: number;
    /** Drawn with x along the line and y across it, about the point [0, 0]. */
    strokes: readonly ImageStroke[];
    /** How large they are at the start of the line and at the end. */
    scale?: number | readonly [number, number];
    /** Degrees, added to the line's direction. */
    turn?: number;
    /** Each one again, reflected across the line. */
    both?: boolean;
    /** Up to this far off their place, in pixels and a tenth as many degrees. */
    jitter?: number;
    seed?: number;
}

export type ImageMark = ImageStroke | ImageSweep | ImageField | ImageAlong;

export interface ImageLayer {
    id?: string;
    shape: ImageShape;
    at?: readonly [number, number];
    size?: readonly [number, number];
    radius?: number | readonly number[];
    radii?: readonly [number, number];
    inner?: number;
    count?: number;
    tooth?: number;
    turn?: number;
    points?: readonly (readonly [number, number])[];
    d?: string;
    rows?: readonly string[];
    palette?: Readonly<Record<string, string>>;
    scale?: number;
    layers?: readonly ImageLayer[];
    strokes?: readonly ImageMark[];
    /** "below": a paint layer's canvas starts as the picture so far, so its strokes and smudges work across everything under it. */
    from?: 'below';
    /** Seen when looking and left out of the .png, while what it masks still works. A figure is one unless told otherwise. */
    guide?: boolean;
    /** A figure: pixels from floor to crown, standing straight. */
    height?: number;
    /** A figure: degrees turned about the body, 0 facing the viewer, 90 facing picture right, 180 away. */
    yaw?: number;
    /** A figure: degrees seen from above. */
    pitch?: number;
    build?: { head?: number; shoulders?: number; chest?: number; waist?: number; hips?: number; limbs?: number };
    pose?: {
        rotate?: Readonly<Record<string, readonly number[]>>;
        move?: Readonly<Record<string, readonly number[]>>;
        /** A joint and where it must be: [x, y] in the picture, or [x, y, z] on the body's own axes. */
        reach?: Readonly<Record<string, { at: readonly number[]; pole?: readonly number[] }>>;
    };
    /** Text: what it says. */
    text?: string;
    fontSize?: number;
    /** A family the machine has, or a font file in the project. */
    font?: string;
    weight?: number | string;
    align?: 'left' | 'center' | 'right';
    /** Characters one under the other, as a sign down a building. */
    vertical?: boolean;
    /** Extra between characters, in pixels. */
    tracking?: number;
    /** Text: pixels taken off each stroke of the letters, for the white-hot core of a neon tube. */
    thin?: number;
    /** Text: 0..1 how much the surface shows through, as worn paint, and how much it is rubbed away in streaks. */
    grain?: number;
    grainScale?: number;
    dry?: number;
    /** Text or paint: a face of a block already drawn, "id.a", to lie on: text within `within`, and strokes with their points counted 0..1 across it and 0..1 down. */
    face?: string;
    /** On a face, the part it takes: left, top, right, bottom, each 0..1. */
    within?: readonly number[];
    /** Text: four corners in the picture it is laid on, in order round from the top left, so it lies on a wall in perspective. */
    quad?: readonly (readonly number[])[];
    /** A repaint: the brush the whole picture so far is painted again with. */
    brush?: string;
    /** A repaint: how far down its strokes go, 0 broad to 2 fine, and what gets finer strokes still. */
    detail?: number;
    boost?: readonly string[];
    seed?: number;
    /** A bloom: how bright a pixel must be to shine, 0..1, and how much it does. */
    threshold?: number;
    strength?: number;
    /** A block or a perspective: the points lines recede to. */
    vanish?: readonly (readonly number[])[];
    /** A block: how far each face runs toward its vanishing point, 0..1. */
    depth?: readonly number[];
    /** A block: the fill of each face, and of the roof if it can be seen. */
    faces?: readonly ImageFill[];
    roof?: ImageFill;
    /** A reflect: the line it mirrors about, level or as points along where things meet the ground, how far down it reaches, and how far it wavers and smears in pixels. */
    y?: number;
    edge?: readonly (readonly number[])[];
    reach?: number;
    ripple?: number;
    smear?: number;
    /** An image: a picture in the project. */
    src?: string;
    /** Drawn everywhere but inside this earlier layer. */
    except?: string;
    /** A figure: where the light is, x right, y up, z toward the viewer. */
    light?: readonly number[];
    fill?: ImageFill;
    stroke?: { color: ImageFill; width: number; align?: 'center' | 'inside' | 'outside'; join?: 'round' | 'miter' | 'bevel'; cap?: 'round' | 'butt' | 'square' };
    opacity?: number;
    blend?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'add';
    transform?: ImageTransform;
    mirror?: 'x' | 'y';
    effects?: readonly ImageEffect[];
    clip?: string;
    erase?: boolean;
    visible?: boolean;
    /** Softens the layer as drawn, with its effects, in the picture's pixels. On a group it softens the group as one thing. */
    blur?: number;
}

export interface ImageSource {
    version?: number;
    size: number | readonly [number, number];
    background?: string;
    layers: readonly ImageLayer[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isColor = (v: unknown): boolean => typeof v === 'string' && /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);

function checkFill(v: unknown): string | null {
    if (typeof v === 'string') return isColor(v) ? null : `${JSON.stringify(v)} must be #rgb, #rgba, #rrggbb or #rrggbbaa`;
    const f = v as Record<string, unknown> | null;
    if (typeof f !== 'object' || f === null) return 'must be a colour or a gradient';
    if (f.type !== 'linear' && f.type !== 'radial' && f.type !== 'noise' && f.type !== 'form' && f.type !== 'image' && f.type !== 'grid') return 'a gradient has type linear, radial, noise, form, image or grid';
    if (f.type === 'grid') {
        if (!Array.isArray(f.colors) || f.colors.length === 0 || !f.colors.every(isColor)) return 'a grid needs colors: one or more';
        for (const key of ['ground', 'off']) if (f[key] !== undefined && !isColor(f[key])) return `a grid's ${key} must be a colour`;
        const quad = f.quad as unknown[] | undefined;
        if (quad !== undefined && !(Array.isArray(quad) && quad.length === 4 && quad.every(isPair))) return 'a grid\'s quad must be four [x, y], in order round from the top left';
        if (f.cell === undefined && f.cells === undefined) return 'a grid needs cell: [w, h] in pixels, or cells: [columns, rows]';
        for (const key of ['cell', 'cells']) if (f[key] !== undefined && !(isPair(f[key]) && (f[key] as number[]).every((v) => v > 0))) return `a grid's ${key} must be two positive numbers`;
        if (f.cell !== undefined && quad !== undefined) return 'a grid on a quad is counted in cells: [columns, rows]';
        if (f.mark !== undefined && !(isPair(f.mark) && (f.mark as number[]).every((v) => v > 0 && v <= 1))) return 'a grid\'s mark must be [w, h], each above 0 and up to 1';
        if (f.lit !== undefined && !(isNum(f.lit) && (f.lit as number) >= 0 && (f.lit as number) <= 1)) return 'a grid\'s lit must be 0..1';
        if (f.seed !== undefined && !Number.isInteger(f.seed)) return 'a grid\'s seed must be a whole number';
        return null;
    }
    if (f.type === 'image') return typeof f.image === 'string' && f.image ? null : 'an image fill needs image, the id of an image layer drawn before it';
    if (f.type === 'form') {
        if (typeof f.figure !== 'string' || !f.figure) return 'a form needs figure, the id of a figure drawn before it';
        if (f.light !== undefined && !(Array.isArray(f.light) && f.light.length === 3 && f.light.every(isNum))) return 'a form\'s light must be [x, y, z], x right, y up, z toward the viewer';
    }
    if (f.type === 'noise') {
        if (f.scale !== undefined && !(isNum(f.scale) && (f.scale as number) > 0)) return 'noise scale must be a positive number of pixels';
        if (f.octaves !== undefined && !(Number.isInteger(f.octaves) && (f.octaves as number) >= 1 && (f.octaves as number) <= 8)) return 'noise octaves must be a whole number from 1 to 8';
        if (f.seed !== undefined && !Number.isInteger(f.seed)) return 'noise seed must be a whole number';
    }
    if (f.type === 'linear' && !(isPair(f.from) && isPair(f.to))) return 'a linear gradient needs from and to, each [x, y]';
    if (f.type === 'linear' && (f.from as number[])[0] === (f.to as number[])[0] && (f.from as number[])[1] === (f.to as number[])[1]) return 'a linear gradient needs from and to apart: at one point it draws a single flat colour';
    if (f.type === 'radial' && !(isPair(f.at) && isNum(f.radius) && (f.radius as number) > 0)) return 'a radial gradient needs at: [x, y] and a positive radius';
    if (!Array.isArray(f.stops) || f.stops.length < 2) return 'a gradient needs two stops or more, each [0..1, colour]';
    for (const s of f.stops as unknown[]) {
        if (!Array.isArray(s) || s.length !== 2 || !isNum(s[0]) || !isColor(s[1])) return `a stop ${JSON.stringify(s)} must be [0..1, colour]`;
    }
    return null;
}

const FIELDS = ['id', 'shape', 'at', 'size', 'radius', 'radii', 'inner', 'count', 'tooth', 'turn', 'points', 'd', 'rows', 'palette', 'scale', 'layers', 'fill', 'stroke', 'opacity', 'blend', 'transform', 'mirror', 'effects', 'clip', 'erase', 'visible', 'blur', 'strokes', 'from', 'guide', 'height', 'yaw', 'pitch', 'build', 'pose', 'light', 'src', 'except', 'text', 'fontSize', 'font', 'weight', 'align', 'vertical', 'tracking', 'vanish', 'depth', 'faces', 'roof', 'y', 'edge', 'reach', 'ripple', 'smear', 'quad', 'threshold', 'strength', 'thin', 'grain', 'grainScale', 'dry', 'face', 'within', 'brush', 'detail', 'boost', 'seed'];

/** Layers that are aids to drawing unless told otherwise: seen when looking, and not in the .png. */
export const isGuideLayer = (l: ImageLayer): boolean => l.guide ?? (l.shape === 'figure' || l.shape === 'image' || l.shape === 'perspective');
const SHAPES: readonly ImageShape[] = ['rect', 'circle', 'ellipse', 'ring', 'polygon', 'line', 'star', 'gear', 'path', 'pixels', 'paint', 'figure', 'image', 'text', 'block', 'perspective', 'reflect', 'bloom', 'repaint', 'group'];
const STROKE_FIELDS = ['points', 'color', 'to', 'size', 'hardness', 'opacity', 'taper', 'bristles', 'strand', 'spread', 'vary', 'wobble', 'seed', 'smudge', 'erase', 'blend', ...BRUSH_FIELDS];

/** What a brush's own settings must be, on whatever carries them. */
function brushProblem(s: Record<string, unknown>): string | null {
    if (s.brush !== undefined && !(typeof s.brush === 'string' && Object.hasOwn(IMAGE_BRUSHES, s.brush))) return `brush ${JSON.stringify(s.brush)} must be one of ${Object.keys(IMAGE_BRUSHES).join(', ')}`;
    for (const key of ['roundness', 'grain', 'dry', 'wet', 'edge', 'dab', 'flow']) {
        if (s[key] !== undefined && !(isNum(s[key]) && (s[key] as number) >= 0 && (s[key] as number) <= 1)) return `${key} must be 0..1`;
    }
    if (s.roundness === 0 || s.dab === 0) return `${s.roundness === 0 ? 'roundness' : 'dab'} must be above 0`;
    for (const key of ['grainScale', 'spacing']) if (s[key] !== undefined && !(isNum(s[key]) && (s[key] as number) > 0)) return `${key} must be positive`;
    if (s.scatter !== undefined && !(isNum(s.scatter) && (s.scatter as number) >= 0)) return 'scatter must be 0 or more';
    if (s.angle !== undefined && !isNum(s.angle)) return 'angle must be degrees';
    if (s.fade !== undefined && !(Array.isArray(s.fade) && s.fade.length === 2 && s.fade.every((t) => isNum(t) && t >= 0 && t <= 1))) return 'fade must be [start, end], each 0..1';
    return null;
}

const SWEEP_FIELDS = ['type', 'guides', 'colors', 'count', 'tip', 'size', 'clumps', 'gather', 'flyaway', 'vary', 'wobble', 'opacity', 'taper', 'seed', 'hardness', ...BRUSH_FIELDS];
const ALONG_FIELDS = ['type', 'line', 'count', 'strokes', 'scale', 'turn', 'both', 'jitter', 'seed'];
const FIELD_FIELDS = ['type', 'region', 'guides', 'angle', 'tone', 'smudge', 'size', 'length', 'coverage', 'spread', 'vary', 'opacity', 'hardness', 'seed', 'taper', ...BRUSH_FIELDS];
const isGuide = (g: unknown): boolean => Array.isArray(g) && g.length >= 2 && g.every((p) => Array.isArray(p) && (p.length === 2 || p.length === 3) && p.every(isNum));
export const MAX_MARK_STROKES = 30000;

function markProblem(s: Record<string, unknown>): string | null {
    const zeroToOne = (keys: readonly string[]): string | null => {
        for (const key of keys) if (s[key] !== undefined && !(isNum(s[key]) && (s[key] as number) >= 0 && (s[key] as number) <= 1)) return `${key} must be 0..1`;
        return null;
    };
    const fields = s.type === 'sweep' ? SWEEP_FIELDS : s.type === 'along' ? ALONG_FIELDS : FIELD_FIELDS;
    for (const key of Object.keys(s)) if (!fields.includes(key)) return `has unknown field "${key}"; a ${String(s.type)} takes ${fields.join(', ')}`;
    if (s.seed !== undefined && !Number.isInteger(s.seed)) return 'seed must be a whole number';
    if (s.type !== 'along') {
        const bad = brushProblem(s);
        if (bad) return bad;
    }
    if (s.type === 'sweep') {
        if (!Array.isArray(s.guides) || s.guides.length < 2 || !s.guides.every(isGuide)) return 'needs guides: two or more lines, each two or more [x, y]';
        if (!Array.isArray(s.colors) || s.colors.length === 0 || !s.colors.every(isColor)) return 'needs colors: one or more, across the guides';
        if (s.tip !== undefined && !isColor(s.tip)) return 'tip must be a colour';
        if (!(Number.isInteger(s.count) && (s.count as number) >= 1 && (s.count as number) <= MAX_MARK_STROKES)) return `count must be a whole number from 1 to ${MAX_MARK_STROKES}`;
        if (s.clumps !== undefined && !(Number.isInteger(s.clumps) && (s.clumps as number) >= 1)) return 'clumps must be a whole number of 1 or more';
        for (const key of ['size', 'wobble']) if (s[key] !== undefined && !(isNum(s[key]) && (s[key] as number) >= 0)) return `${key} must be 0 or more`;
        if (s.taper !== undefined && !(Array.isArray(s.taper) && s.taper.length === 2 && s.taper.every((t) => isNum(t) && t >= 0 && t <= 1))) return 'taper must be [start, end], each 0..1';
        return zeroToOne(['gather', 'flyaway', 'vary', 'opacity']);
    }
    if (s.type === 'along') {
        if (!isGuide(s.line)) return 'needs a line: two or more [x, y]';
        if (!(Number.isInteger(s.count) && (s.count as number) >= 1 && (s.count as number) <= 2000)) return 'count must be a whole number from 1 to 2000';
        if (!Array.isArray(s.strokes) || s.strokes.length === 0) return 'needs strokes, drawn about [0, 0]';
        for (const [n, inner] of (s.strokes as Record<string, unknown>[]).entries()) {
            if (inner?.type !== undefined) return `strokes[${n}] must be a plain stroke`;
            const bad = strokeProblem(inner);
            if (bad) return `strokes[${n}] ${bad}`;
        }
        const scale = s.scale;
        if (scale !== undefined && !(isNum(scale) && scale > 0) && !(isPair(scale) && (scale as number[]).every((v) => v > 0))) return 'scale must be a positive number, or [start, end]';
        for (const key of ['turn', 'jitter']) if (s[key] !== undefined && !isNum(s[key])) return `${key} must be a number`;
        return null;
    }
    if (s.region !== undefined) {
        if (typeof s.region !== 'string') return 'region must be an SVG path or "@id"';
        if (!s.region.startsWith('@')) {
            try { parsePath(s.region); } catch (e) { return `region: ${(e as Error).message}`; }
        }
    }
    if (s.guides !== undefined && !(Array.isArray(s.guides) && s.guides.length > 0 && s.guides.every(isGuide))) return 'guides must be one or more lines, each two or more [x, y]';
    if (s.angle !== undefined && !isNum(s.angle)) return 'angle must be degrees';
    if (s.tone === undefined && !s.smudge) return 'needs a tone, unless it smudges';
    if (s.tone !== undefined) {
        const bad = checkFill(s.tone);
        if (bad) return `tone ${bad}`;
    }
    for (const key of ['size', 'length', 'coverage']) {
        if (s[key] !== undefined && !(isNum(s[key]) && (s[key] as number) > 0)) return `${key} must be positive`;
    }
    if (s.size === undefined) return 'needs a positive size';
    if (s.spread !== undefined && !(isNum(s.spread) && (s.spread as number) >= 0)) return 'spread must be 0 or more degrees';
    return zeroToOne(['vary', 'opacity', 'hardness', 'smudge']);
}

function strokeProblem(s: Record<string, unknown>): string | null {
    if (typeof s !== 'object' || s === null) return 'must be an object';
    if (s.type === undefined) {
        const bad = brushProblem(s);
        if (bad) return bad;
    }
    if (s.type === 'sweep' || s.type === 'field' || s.type === 'along') return markProblem(s);
    if (s.type !== undefined) return `has type "${String(s.type)}"; there are sweep, field and along, or none for one stroke`;
    for (const key of Object.keys(s)) if (!STROKE_FIELDS.includes(key)) return `has unknown field "${key}"; a stroke takes ${STROKE_FIELDS.join(', ')}`;
    if (!Array.isArray(s.points) || s.points.length === 0 || !s.points.every((p) => Array.isArray(p) && (p.length === 2 || p.length === 3) && p.every(isNum))) return 'needs points, each [x, y] or [x, y, pressure]';
    if (!(isNum(s.size) && (s.size as number) > 0)) return 'needs a positive size';
    const paints = !s.erase && !s.smudge;
    if (paints && s.color === undefined) return 'needs a color, unless it erases or smudges';
    for (const key of ['color', 'to']) if (s[key] !== undefined && !isColor(s[key])) return `${key} must be #rgb, #rgba, #rrggbb or #rrggbbaa`;
    for (const key of ['hardness', 'opacity', 'vary', 'smudge']) if (s[key] !== undefined && !(isNum(s[key]) && (s[key] as number) >= 0 && (s[key] as number) <= 1)) return `${key} must be 0..1`;
    for (const key of ['strand', 'spread', 'wobble']) if (s[key] !== undefined && !(isNum(s[key]) && (s[key] as number) >= 0)) return `${key} must be 0 or more`;
    if (s.bristles !== undefined && !(Number.isInteger(s.bristles) && (s.bristles as number) >= 1 && (s.bristles as number) <= 200)) return 'bristles must be a whole number from 1 to 200';
    if (s.seed !== undefined && !Number.isInteger(s.seed)) return 'seed must be a whole number';
    if (s.taper !== undefined && !(Array.isArray(s.taper) && s.taper.length === 2 && s.taper.every((t) => isNum(t) && t >= 0 && t <= 1))) return 'taper must be [start, end], each 0..1';
    if (s.blend !== undefined && !['normal', 'multiply', 'screen', 'overlay', 'add'].includes(s.blend as string)) return 'blend must be normal, multiply, screen, overlay or add';
    return null;
}

function checkLayer(l: Record<string, unknown>, where: string, ids: Set<string>): void {
    const fail = (what: string): never => { throw new Error(`${where}: ${what}`); };
    if (typeof l !== 'object' || l === null) fail('must be an object');
    for (const key of Object.keys(l)) if (!FIELDS.includes(key)) fail(`unknown field "${key}"; a layer takes ${FIELDS.join(', ')}`);
    if (!SHAPES.includes(l.shape as ImageShape)) fail(`shape ${JSON.stringify(l.shape)} must be one of ${SHAPES.join(', ')}`);
    if (l.id !== undefined) {
        if (typeof l.id !== 'string' || !l.id) fail('id must be a string');
        if (ids.has(l.id as string)) fail(`the id "${String(l.id)}" is already used`);
        ids.add(l.id as string);
    }
    const num = (k: string, ok: (n: number) => boolean = () => true): void => { if (!isNum(l[k]) || !ok(l[k] as number)) fail(`${k} must be a number${ok === positive ? ' above 0' : ''}`); };
    const pair = (k: string): void => { if (!isPair(l[k])) fail(`${k} must be [a, b]`); };
    const positive = (n: number): boolean => n > 0;
    switch (l.shape) {
        case 'rect': if (l.face === undefined) { pair('at'); pair('size'); } if (l.radius !== undefined && !isNum(l.radius) && !(Array.isArray(l.radius) && l.radius.length === 4 && l.radius.every(isNum))) fail('radius must be a number or four corners'); break;
        case 'circle': pair('at'); num('radius', positive); break;
        case 'ellipse': pair('at'); pair('radii'); break;
        case 'ring': pair('at'); num('radius', positive); num('inner', positive); if ((l.inner as number) >= (l.radius as number)) fail('inner must be less than radius'); break;
        case 'polygon': case 'line':
            if (!Array.isArray(l.points) || l.points.length < (l.shape === 'line' ? 2 : 3) || !l.points.every(isPair)) fail(`points must be ${l.shape === 'line' ? 'two' : 'three'} or more [x, y]`);
            if (l.shape === 'line' && !l.stroke) fail('a line needs a stroke: { color, width }');
            break;
        case 'star': case 'gear': pair('at'); num('radius', positive); num('inner', positive); if (!Number.isInteger(l.count) || (l.count as number) < 3) fail('count must be 3 or more'); break;
        case 'path':
            if (typeof l.d !== 'string' || !l.d.trim()) fail('d must be an SVG path: M L H V C S Q T Z');
            // Here and not when it is drawn: a hidden layer is not drawn, and an error waits until it is shown.
            try {
                if (parsePath(l.d as string).every((run) => run.points.length === 0)) fail('d draws nothing');
            } catch (e) {
                fail((e as Error).message);
            }
            break;
        case 'figure': {
            if (!isPair(l.at)) fail('at must be [x, y]: the place on the floor under her');
            if (!(isNum(l.height) && (l.height as number) > 0)) fail('height must be pixels from floor to crown');
            for (const key of ['yaw', 'pitch']) if (l[key] !== undefined && !isNum(l[key])) fail(`${key} must be degrees`);
            if (l.light !== undefined && !(Array.isArray(l.light) && l.light.length === 3 && l.light.every(isNum))) fail('light must be [x, y, z], x right, y up, z toward the viewer');
            const build = l.build as Record<string, unknown> | undefined;
            for (const [key, value] of Object.entries(build ?? {})) {
                if (!['head', 'shoulders', 'chest', 'waist', 'hips', 'limbs'].includes(key)) fail(`build has unknown "${key}"; it takes head, shoulders, chest, waist, hips, limbs`);
                if (!(isNum(value) && (value as number) > 0)) fail(`build ${key} must be positive`);
            }
            const pose = l.pose as Record<string, Record<string, unknown>> | undefined;
            for (const key of Object.keys(pose ?? {})) if (!['rotate', 'move', 'reach'].includes(key)) fail(`pose has unknown "${key}"; it takes rotate, move, reach`);
            for (const [key, list] of Object.entries(pose ?? {})) {
                for (const [joint, value] of Object.entries(list)) {
                    const numbers = key === 'reach' ? (value as { at?: unknown }).at : value;
                    const lengths = key === 'reach' ? [2, 3] : [3];
                    if (!(Array.isArray(numbers) && lengths.includes(numbers.length) && numbers.every(isNum))) fail(`pose ${key} "${joint}" must be ${key === 'reach' ? '{ at: [x, y] or [x, y, z] }' : '[x, y, z]'}`);
                }
            }
            break;
        }
        case 'text':
            if (typeof l.text !== 'string' || !l.text) fail('text must say something');
            if (l.within !== undefined && !(Array.isArray(l.within) && l.within.length === 4 && l.within.every((v) => isNum(v) && v >= 0 && v <= 1))) fail('within must be [left, top, right, bottom], each 0..1');
            if (l.face !== undefined) {
                if (typeof l.face !== 'string') fail('face must name a face of a block, as "id.a"');
            } else if (l.quad !== undefined) {
                if (!(Array.isArray(l.quad) && l.quad.length === 4 && l.quad.every(isPair))) fail('quad must be four [x, y], in order round from the top left');
            } else {
                pair('at');
                if (!(isNum(l.fontSize) && (l.fontSize as number) > 0)) fail('fontSize must be positive, in pixels');
            }
            if (l.font !== undefined && typeof l.font !== 'string') fail('font must be a family name or a font file in the project');
            if (l.align !== undefined && !['left', 'center', 'right'].includes(l.align as string)) fail('align must be left, center or right');
            if (l.tracking !== undefined && !isNum(l.tracking)) fail('tracking must be pixels');
            if (l.thin !== undefined && !(isNum(l.thin) && (l.thin as number) >= 0)) fail('thin must be 0 or more pixels');
            for (const key of ['grain', 'dry']) if (l[key] !== undefined && !(isNum(l[key]) && (l[key] as number) >= 0 && (l[key] as number) <= 1)) fail(`${key} must be 0..1`);
            if (l.grainScale !== undefined && !(isNum(l.grainScale) && (l.grainScale as number) > 0)) fail('grainScale must be positive');
            if (l.fill === undefined && l.stroke === undefined) fail('it needs a fill or a stroke, or it draws nothing');
            break;
        case 'repaint':
            if (l.brush !== undefined && !(typeof l.brush === 'string' && Object.hasOwn(IMAGE_BRUSHES, l.brush))) fail(`brush ${JSON.stringify(l.brush)} must be one of ${Object.keys(IMAGE_BRUSHES).join(', ')}`);
            if (l.detail !== undefined && ![0, 1, 2].includes(l.detail as number)) fail('detail must be 0, 1 or 2');
            if (l.boost !== undefined && !(Array.isArray(l.boost) && l.boost.every((b) => typeof b === 'string'))) fail('boost must be ids of layers drawn before it');
            if (l.seed !== undefined && !Number.isInteger(l.seed)) fail('seed must be a whole number');
            break;
        case 'bloom':
            for (const key of ['threshold', 'strength']) if (l[key] !== undefined && !(isNum(l[key]) && (l[key] as number) >= 0)) fail(`${key} must be 0 or more`);
            if (l.threshold !== undefined && (l.threshold as number) > 1) fail('threshold must be 0..1');
            if (l.radius !== undefined && !(isNum(l.radius) && (l.radius as number) > 0)) fail('radius must be positive, in pixels');
            break;
        case 'perspective':
            if (!Array.isArray(l.vanish) || l.vanish.length === 0 || !l.vanish.every(isPair)) fail('vanish must be one or more [x, y]');
            break;
        case 'block': {
            pair('at');
            if (!(isNum(l.height) && (l.height as number) > 0)) fail('height must be pixels, from the corner at its foot up to its top');
            if (!Array.isArray(l.vanish) || l.vanish.length < 1 || l.vanish.length > 2 || !l.vanish.every(isPair)) fail('vanish must be one or two [x, y], where its faces recede to');
            if (!Array.isArray(l.depth) || l.depth.length !== (l.vanish as unknown[]).length || !l.depth.every((d) => isNum(d) && d > 0 && d <= 1)) fail('depth must give each vanishing point how far the face runs toward it, each above 0 and up to 1');
            if (!Array.isArray(l.faces) || l.faces.length !== (l.vanish as unknown[]).length) fail('faces must give one fill for each vanishing point');
            for (const face of l.faces as unknown[]) { const bad = checkFill(face); if (bad) fail(`face ${bad}`); }
            if (l.roof !== undefined) { const bad = checkFill(l.roof); if (bad) fail(`roof ${bad}`); }
            break;
        }
        case 'reflect':
            if (!isNum(l.y) && !(Array.isArray(l.edge) && l.edge.length >= 2 && l.edge.every(isPair))) fail('y must be the line it mirrors about, or edge two or more [x, y] along where things meet the ground');
            for (const key of ['reach', 'ripple', 'smear']) if (l[key] !== undefined && !(isNum(l[key]) && (l[key] as number) >= 0)) fail(`${key} must be 0 or more pixels`);
            break;
        case 'image':
            if (typeof l.src !== 'string' || !l.src) fail('src must be the path of a picture in the project');
            if (l.at !== undefined && !isPair(l.at)) fail('at must be [x, y]');
            if (l.size !== undefined && !isPair(l.size)) fail('size must be [w, h]');
            break;
        case 'paint': {
            if (!Array.isArray(l.strokes)) fail('strokes must be an array, which may start empty');
            if (l.face !== undefined && typeof l.face !== 'string') fail('face must name a face of a block, as "id.a"');
            if (l.from !== undefined && l.from !== 'below') fail('from must be "below"');
            if (l.from !== undefined && (l.fill !== undefined || l.effects !== undefined || l.blend !== undefined)) fail('from "below" works on the picture itself, and takes no fill, effects or blend');
            (l.strokes as Record<string, unknown>[]).forEach((s, n) => {
                const bad = strokeProblem(s);
                if (bad) fail(`stroke ${n} ${bad}`);
            });
            break;
        }
        case 'pixels': {
            if (!Array.isArray(l.rows) || l.rows.length === 0 || !l.rows.every((r) => typeof r === 'string')) fail('rows must be strings, one character a pixel');
            const pal = l.palette as Record<string, unknown> | undefined;
            if (typeof pal !== 'object' || pal === null) fail('palette must be { character: colour }');
            for (const [k, v] of Object.entries(pal!)) {
                if ([...k].length !== 1) fail(`palette key ${JSON.stringify(k)} must be one character`);
                if (!isColor(v)) fail(`palette "${k}" ${JSON.stringify(v)} must be a colour`);
            }
            const known = new Set(Object.keys(pal!));
            const width = (l.rows as string[])[0]!.length;
            (l.rows as string[]).forEach((row, i) => {
                if ([...row].length !== width) fail(`row ${i} is ${[...row].length} wide and row 0 is ${width}: a slip here shifts everything after it`);
                for (const ch of row) if (ch !== '.' && ch !== ' ' && !known.has(ch)) fail(`row ${i} has "${ch}", which is not in the palette; "." and " " are nothing`);
            });
            if (l.scale !== undefined) num('scale', positive);
            if (l.at !== undefined) pair('at');
            break;
        }
        case 'group':
            if (!Array.isArray(l.layers)) fail('a group needs layers');
            (l.layers as Record<string, unknown>[]).forEach((c, i) => checkLayer(c, `${where}.layers[${i}]`, ids));
            break;
        default:
    }
    if (l.fill !== undefined) { const bad = checkFill(l.fill); if (bad) fail(`fill ${bad}`); }
    if (l.stroke !== undefined) {
        const s = l.stroke as Record<string, unknown>;
        if (typeof s !== 'object' || s === null || !isNum(s.width) || (s.width as number) <= 0) fail('stroke must be { color, width, align? }');
        const bad = checkFill(s.color);
        if (bad) fail(`stroke color ${bad}`);
        if (s.align !== undefined && !['center', 'inside', 'outside'].includes(s.align as string)) fail('stroke align must be center, inside or outside');
        if (s.join !== undefined && !['round', 'miter', 'bevel'].includes(s.join as string)) fail('stroke join must be round, miter or bevel');
        if (s.cap !== undefined && !['round', 'butt', 'square'].includes(s.cap as string)) fail('stroke cap must be round, butt or square');
    }
    if (!['group', 'pixels', 'paint', 'figure', 'image', 'text', 'block', 'perspective', 'reflect', 'bloom', 'repaint', 'line'].includes(l.shape as string) && l.fill === undefined && l.stroke === undefined && !l.erase) fail('it needs a fill or a stroke, or it draws nothing');
    if (l.from !== undefined && l.shape !== 'paint') fail('from is for a paint layer');
    if (l.guide !== undefined && typeof l.guide !== 'boolean') fail('guide must be true or false');
    if (l.blur !== undefined && !(isNum(l.blur) && (l.blur as number) >= 0)) fail('blur must be 0 or more, in pixels');
    if (l.blur && l.erase) fail('blur does not go with erase; put what cuts in a group with what it cuts, and blur the group');
    if (l.opacity !== undefined && !(isNum(l.opacity) && l.opacity >= 0 && l.opacity <= 1)) fail('opacity must be 0..1');
    if (l.blend !== undefined && !['normal', 'multiply', 'screen', 'overlay', 'add'].includes(l.blend as string)) fail('blend must be normal, multiply, screen, overlay or add');
    if (l.mirror !== undefined && l.mirror !== 'x' && l.mirror !== 'y') fail('mirror must be x or y');
    if (l.clip !== undefined && typeof l.clip !== 'string') fail('clip must be a layer id');
    if (l.transform !== undefined) {
        const t = l.transform as Record<string, unknown>;
        for (const key of Object.keys(t)) if (!['translate', 'rotate', 'scale', 'origin'].includes(key)) fail(`transform has an unknown field "${key}"`);
        if (t.translate !== undefined && !isPair(t.translate)) fail('transform.translate must be [x, y]');
        if (t.origin !== undefined && !isPair(t.origin)) fail('transform.origin must be [x, y]');
        if (t.rotate !== undefined && !isNum(t.rotate)) fail('transform.rotate must be degrees');
        if (t.scale !== undefined && !isNum(t.scale) && !isPair(t.scale)) fail('transform.scale must be a number or [x, y]');
    }
    if (l.effects !== undefined) {
        if (!Array.isArray(l.effects)) fail('effects must be an array');
        for (const e of l.effects as Record<string, unknown>[]) {
            if (!['shadow', 'glow', 'innerShadow', 'innerGlow'].includes(e?.type as string)) fail(`an effect has type ${JSON.stringify(e?.type)}; there are shadow, glow, innerShadow, innerGlow`);
            for (const key of Object.keys(e)) if (!['type', 'color', 'x', 'y', 'blur', 'opacity'].includes(key)) fail(`effect ${String(e.type)} has an unknown field "${key}"`);
            if (e.color !== undefined && !isColor(e.color)) fail(`effect ${String(e.type)}: color must be #rgb..#rrggbbaa`);
            for (const k of ['x', 'y', 'blur', 'opacity']) if (e[k] !== undefined && !isNum(e[k])) fail(`effect ${String(e.type)}: ${k} must be a number`);
        }
    }
}

/** The source if it is well formed; otherwise throws, naming the layer and the field. */
export function validateImageSource(raw: unknown): ImageSource {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('an image source must be { size, layers }');
    const s = raw as Record<string, unknown>;
    for (const key of Object.keys(s)) if (!['version', 'size', 'background', 'layers'].includes(key)) throw new Error(`unknown field "${key}"; an image has version, size, background, layers`);
    if (s.version !== undefined && s.version !== IMAGE_SOURCE_VERSION) throw new Error(`version ${String(s.version)} is not one this editor reads (${IMAGE_SOURCE_VERSION})`);
    const [w, h] = typeof s.size === 'number' ? [s.size, s.size] : isPair(s.size) ? (s.size as number[]) : [NaN, NaN];
    if (!Number.isInteger(w) || !Number.isInteger(h) || w! < 1 || h! < 1 || w! > MAX_IMAGE_SIZE || h! > MAX_IMAGE_SIZE) throw new Error(`size must be a whole number or [width, height], 1..${MAX_IMAGE_SIZE}`);
    if (s.background !== undefined && !isColor(s.background)) throw new Error('background must be a colour; leave it out for a transparent picture');
    if (!Array.isArray(s.layers)) throw new Error('layers must be an array');
    const ids = new Set<string>();
    (s.layers as Record<string, unknown>[]).forEach((l, i) => checkLayer(l, `layer ${i}${l?.id ? ` "${String(l.id)}"` : ''}`, ids));
    return { version: IMAGE_SOURCE_VERSION, ...(s as unknown as ImageSource) };
}

export type ImageEdit =
    | { op: 'set'; layer: string; fields: Record<string, unknown> }
    | { op: 'insert'; layer: ImageLayer; before?: string; after?: string; into?: string }
    | { op: 'remove'; layer: string }
    | { op: 'move'; layer: string; before?: string; after?: string; into?: string }
    | { op: 'paint'; layer: string; strokes?: readonly ImageMark[]; drop?: number; at?: number; remove?: number }
    | { op: 'wrap'; layers: readonly string[]; group: Partial<ImageLayer> }
    | { op: 'unwrap'; layer: string }
    | {
        op: 'pixels';
        layer: string;
        set?: readonly { row: number; at?: number; text: string }[];
        rect?: readonly { x: number; y: number; w?: number; h?: number; text: string }[];
        palette?: Readonly<Record<string, string | null>>;
    }
    | { op: 'settings'; fields: { size?: ImageSource['size']; background?: string | null } };

/** Every stroke width a source draws with, and how many layers use each: what drifts first across a set of icons. */
export function strokeWidths(source: ImageSource): Record<string, number> {
    const out: Record<string, number> = {};
    const walk = (layers: readonly ImageLayer[]): void => {
        for (const l of layers) {
            if (l.stroke) out[String(l.stroke.width)] = (out[String(l.stroke.width)] ?? 0) + 1;
            if (l.layers) walk(l.layers);
        }
    };
    walk(source.layers);
    return out;
}

/** A source with @p edits applied in order, where layers are named by id at any depth. Throws, naming what it could not find. */
export function applyImageEdits(source: ImageSource, edits: readonly ImageEdit[]): ImageSource {
    const clone = JSON.parse(JSON.stringify(source)) as { size: ImageSource['size']; background?: string; version?: number; layers: (ImageLayer & Record<string, unknown>)[] };
    type Row = ImageLayer & Record<string, unknown>;
    const allIds: string[] = [];
    const find = (id: string, list: Row[] = clone.layers): { list: Row[]; index: number } | null => {
        for (let i = 0; i < list.length; i++) {
            if (list[i]!.id === id) return { list, index: i };
            if (list[i]!.layers) {
                const hit = find(id, list[i]!.layers as Row[]);
                if (hit) return hit;
            }
        }
        return null;
    };
    const need = (id: string): { list: Row[]; index: number } => {
        const hit = find(id);
        if (hit) return hit;
        allIds.length = 0;
        const walk = (list: Row[]): void => { for (const l of list) { if (l.id) allIds.push(l.id); if (l.layers) walk(l.layers as Row[]); } };
        walk(clone.layers);
        throw new Error(`no layer "${id}"; ids: ${allIds.join(', ') || '(none: give layers an id to edit them)'}`);
    };
    for (const edit of edits) {
        switch (edit?.op) {
            case 'set': {
                const { list, index } = need(edit.layer);
                for (const [k, v] of Object.entries(edit.fields ?? {})) {
                    if (v === null) delete list[index]![k];
                    else list[index]![k] = v;
                }
                break;
            }
            case 'insert': {
                if (edit.into !== undefined) {
                    const { list, index } = need(edit.into);
                    const group = list[index]!;
                    if (group.shape !== 'group') throw new Error(`layer "${edit.into}" is not a group`);
                    (group.layers as Row[]).push(edit.layer as Row);
                } else if (edit.before !== undefined) {
                    const { list, index } = need(edit.before);
                    list.splice(index, 0, edit.layer as Row);
                } else if (edit.after !== undefined) {
                    const { list, index } = need(edit.after);
                    list.splice(index + 1, 0, edit.layer as Row);
                } else clone.layers.push(edit.layer as Row);
                break;
            }
            case 'remove': {
                const { list, index } = need(edit.layer);
                list.splice(index, 1);
                break;
            }
            case 'move': {
                const given = [edit.before, edit.after, edit.into].filter((v) => v !== undefined);
                if (given.length > 1) throw new Error('move takes one of before, after and into');
                const { list, index } = need(edit.layer);
                const [row] = list.splice(index, 1);
                const within = (l: Row): boolean => l.id === given[0] || ((l.layers as Row[] | undefined) ?? []).some(within);
                if (given.length && within(row!)) {
                    list.splice(index, 0, row!);
                    throw new Error(`layer "${edit.layer}" cannot move next to or into "${String(given[0])}", which is itself or inside it`);
                }
                if (edit.into !== undefined) {
                    const target = need(edit.into);
                    const group = target.list[target.index]!;
                    if (group.shape !== 'group') throw new Error(`layer "${edit.into}" is not a group`);
                    (group.layers as Row[]).push(row!);
                } else if (edit.before !== undefined) {
                    const target = need(edit.before);
                    target.list.splice(target.index, 0, row!);
                } else if (edit.after !== undefined) {
                    const target = need(edit.after);
                    target.list.splice(target.index + 1, 0, row!);
                } else clone.layers.push(row!);
                break;
            }
            case 'paint': {
                const { list, index } = need(edit.layer);
                const layer = list[index]!;
                if (layer.shape !== 'paint') throw new Error(`layer "${edit.layer}" is not paint`);
                const had = layer.strokes as readonly ImageMark[];
                const drop = edit.drop ?? 0;
                if (!Number.isInteger(drop) || drop < 0 || drop > had.length) throw new Error(`layer "${edit.layer}" has ${had.length} strokes: cannot drop ${String(edit.drop)}`);
                const kept = had.slice(0, had.length - drop);
                const at = edit.at ?? kept.length;
                const remove = edit.remove ?? 0;
                if (!Number.isInteger(at) || at < 0 || at > kept.length || !Number.isInteger(remove) || remove < 0 || at + remove > kept.length) throw new Error(`layer "${edit.layer}" has ${kept.length} strokes: cannot replace ${remove} at ${at}`);
                kept.splice(at, remove, ...(edit.strokes ?? []));
                layer.strokes = kept;
                break;
            }
            case 'wrap': {
                if (!Array.isArray(edit.layers) || edit.layers.length === 0) throw new Error('wrap needs layers, the ids to put in the group');
                const found = edit.layers.map((id) => ({ id, ...need(id) }));
                if (found.some((f) => f.list !== found[0]!.list)) throw new Error(`wrap takes layers side by side, and ${edit.layers.join(', ')} are not all in one list`);
                const list = found[0]!.list;
                // Kept in the order they draw, whatever order they were named in: wrapping must not change what is over what.
                const indices = found.map((f) => f.index).sort((a, b) => a - b);
                const children = indices.map((i) => list[i]!);
                for (const i of [...indices].reverse()) list.splice(i, 1);
                list.splice(indices[0]!, 0, { ...edit.group, shape: 'group', layers: children } as Row);
                break;
            }
            case 'unwrap': {
                const { list, index } = need(edit.layer);
                const group = list[index]!;
                if (group.shape !== 'group') throw new Error(`layer "${edit.layer}" is not a group`);
                const kept = ['transform', 'effects', 'opacity', 'blend', 'clip', 'mirror', 'visible'].filter((k) => group[k] !== undefined);
                if (kept.length) throw new Error(`group "${edit.layer}" has ${kept.join(', ')}, which its layers would lose; set them to null first`);
                list.splice(index, 1, ...(group.layers as Row[]));
                break;
            }
            case 'pixels': {
                const { list, index } = need(edit.layer);
                const layer = list[index]!;
                if (layer.shape !== 'pixels') throw new Error(`layer "${edit.layer}" is not pixels`);
                const rows = [...(layer.rows as string[])];
                if (edit.palette) {
                    const palette = { ...(layer.palette as Record<string, string>) };
                    for (const [key, value] of Object.entries(edit.palette)) {
                        if (value === null) delete palette[key];
                        else palette[key] = value;
                    }
                    layer.palette = palette;
                }
                for (const area of edit.rect ?? []) {
                    const [w, h, char] = [area.w ?? 1, area.h ?? 1, [...(area.text ?? '')]];
                    if (char.length !== 1) throw new Error(`a rect in "${edit.layer}" paints one character, not "${area.text}"`);
                    const width = [...rows[0]!].length;
                    if (!(Number.isInteger(area.x) && Number.isInteger(area.y) && Number.isInteger(w) && Number.isInteger(h) && area.x >= 0 && area.y >= 0 && w > 0 && h > 0 && area.x + w <= width && area.y + h <= rows.length)) {
                        throw new Error(`layer "${edit.layer}" is ${width} by ${rows.length}: a rect of ${w} by ${h} at ${area.x}, ${area.y} does not fit`);
                    }
                    for (let y = area.y; y < area.y + h; y++) {
                        const chars = [...rows[y]!];
                        chars.fill(char[0]!, area.x, area.x + w);
                        rows[y] = chars.join('');
                    }
                }
                for (const change of edit.set ?? []) {
                    const row = rows[change.row];
                    if (row === undefined) throw new Error(`layer "${edit.layer}" has rows 0..${rows.length - 1}, not ${change.row}`);
                    const chars = [...row], text = [...change.text], at = change.at ?? 0;
                    if (at < 0 || at + text.length > chars.length) throw new Error(`row ${change.row} of "${edit.layer}" is ${chars.length} wide: ${text.length} at ${at} does not fit`);
                    chars.splice(at, text.length, ...text);
                    rows[change.row] = chars.join('');
                }
                layer.rows = rows;
                break;
            }
            case 'settings':
                if (edit.fields?.size !== undefined) clone.size = edit.fields.size;
                if (edit.fields?.background === null) delete clone.background;
                else if (edit.fields?.background !== undefined) clone.background = edit.fields.background;
                break;
            default:
                throw new Error(`an edit has op ${JSON.stringify((edit as { op?: unknown })?.op)}; there are set, insert, remove, move, paint, wrap, unwrap, pixels, settings`);
        }
    }
    return validateImageSource(clone);
}
