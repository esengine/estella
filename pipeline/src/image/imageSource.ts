// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  imageSource.ts — `.esimage`: a picture as a list of layers, what a model writes and edits, and what is wrong with one.
 */
export const IMAGE_SOURCE_EXT = '.esimage';
export const IMAGE_SOURCE_VERSION = 1;
export const MAX_IMAGE_SIZE = 2048;

export type ImageFill = string
    | { type: 'linear'; from: readonly [number, number]; to: readonly [number, number]; stops: readonly (readonly [number, string])[] }
    | { type: 'radial'; at: readonly [number, number]; radius: number; stops: readonly (readonly [number, string])[] };

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

export type ImageShape = 'rect' | 'circle' | 'ellipse' | 'ring' | 'polygon' | 'line' | 'star' | 'gear' | 'path' | 'pixels' | 'group';

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
    fill?: ImageFill;
    stroke?: { color: ImageFill; width: number; align?: 'center' | 'inside' | 'outside' };
    opacity?: number;
    blend?: 'normal' | 'multiply' | 'screen' | 'overlay' | 'add';
    transform?: ImageTransform;
    mirror?: 'x' | 'y';
    effects?: readonly ImageEffect[];
    clip?: string;
    erase?: boolean;
    visible?: boolean;
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
    if (f.type !== 'linear' && f.type !== 'radial') return 'a gradient has type linear or radial';
    if (f.type === 'linear' && !(isPair(f.from) && isPair(f.to))) return 'a linear gradient needs from and to, each [x, y]';
    if (f.type === 'radial' && !(isPair(f.at) && isNum(f.radius) && (f.radius as number) > 0)) return 'a radial gradient needs at: [x, y] and a positive radius';
    if (!Array.isArray(f.stops) || f.stops.length < 2) return 'a gradient needs two stops or more, each [0..1, colour]';
    for (const s of f.stops as unknown[]) {
        if (!Array.isArray(s) || s.length !== 2 || !isNum(s[0]) || !isColor(s[1])) return `a stop ${JSON.stringify(s)} must be [0..1, colour]`;
    }
    return null;
}

const FIELDS = ['id', 'shape', 'at', 'size', 'radius', 'radii', 'inner', 'count', 'tooth', 'turn', 'points', 'd', 'rows', 'palette', 'scale', 'layers', 'fill', 'stroke', 'opacity', 'blend', 'transform', 'mirror', 'effects', 'clip', 'erase', 'visible'];
const SHAPES: readonly ImageShape[] = ['rect', 'circle', 'ellipse', 'ring', 'polygon', 'line', 'star', 'gear', 'path', 'pixels', 'group'];

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
        case 'rect': pair('at'); pair('size'); if (l.radius !== undefined && !isNum(l.radius) && !(Array.isArray(l.radius) && l.radius.length === 4 && l.radius.every(isNum))) fail('radius must be a number or four corners'); break;
        case 'circle': pair('at'); num('radius', positive); break;
        case 'ellipse': pair('at'); pair('radii'); break;
        case 'ring': pair('at'); num('radius', positive); num('inner', positive); if ((l.inner as number) >= (l.radius as number)) fail('inner must be less than radius'); break;
        case 'polygon': case 'line':
            if (!Array.isArray(l.points) || l.points.length < (l.shape === 'line' ? 2 : 3) || !l.points.every(isPair)) fail(`points must be ${l.shape === 'line' ? 'two' : 'three'} or more [x, y]`);
            if (l.shape === 'line' && !l.stroke) fail('a line needs a stroke: { color, width }');
            break;
        case 'star': case 'gear': pair('at'); num('radius', positive); num('inner', positive); if (!Number.isInteger(l.count) || (l.count as number) < 3) fail('count must be 3 or more'); break;
        case 'path': if (typeof l.d !== 'string' || !l.d.trim()) fail('d must be an SVG path: M L H V C S Q T Z'); break;
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
    }
    if (!['group', 'pixels', 'line'].includes(l.shape as string) && l.fill === undefined && l.stroke === undefined && !l.erase) fail('it needs a fill or a stroke, or it draws nothing');
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
    | { op: 'settings'; fields: { size?: ImageSource['size']; background?: string | null } };

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
            case 'settings':
                if (edit.fields?.size !== undefined) clone.size = edit.fields.size;
                if (edit.fields?.background === null) delete clone.background;
                else if (edit.fields?.background !== undefined) clone.background = edit.fields.background;
                break;
            default:
                throw new Error(`an edit has op ${JSON.stringify((edit as { op?: unknown })?.op)}; there are set, insert, remove, settings`);
        }
    }
    return validateImageSource(clone);
}
