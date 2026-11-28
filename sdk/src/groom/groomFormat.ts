// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  groomFormat.ts — a groom on disk: the strands of hair or fur as curves, in groups.
 *
 *        Two files, so that a reimport replaces only what the DCC tool made:
 *
 *        - `.escurves` (binary) is the geometry: per group, the rendered strands and the guide curves, each a run of points with a
 *          radius, and what else the tool wrote (a root UV per curve, a colour per point, a clump id per curve). Written by
 *          tools/blender/export_groom.py.
 *        - `.esgroom` (JSON) names the curves file and holds what is AUTHORED in the engine for each group: its material, its
 *          width, how it narrows to the tip, how much light it lets through, whether it casts shadows. Reimporting the curves
 *          leaves these as they were; a group matches its settings by its index.
 *
 *        Positions are in metres, Y up, in the groom's own space: the loader scales them by the project's world units a metre.
 */

import type { GrowRecipe } from './groomGrow';

/** Magic 'ESCV', little-endian. */
export const CURVES_MAGIC = 0x56435345;
export const CURVES_VERSION = 1;
export const GROOM_FORMAT_VERSION = 1;

/** Which optional attributes a set of curves carries. */
export const CurveAttribute = {
    RootUV: 1,
    Color: 2,
    ClumpId: 4,
} as const;

/** A set of curves: each a run of points from root to tip. */
export interface CurveSet {
    /** How many points each curve has, root first. */
    counts: Uint16Array;
    /** xyz per point, in metres. */
    positions: Float32Array;
    /** Per point, in metres: half the strand's width there. */
    radii: Float32Array;
    /** Per curve, where its root sits on the surface it grew from (uv). */
    rootUV?: Float32Array;
    /** Per point, rgba bytes. */
    colors?: Uint8Array;
    /** Per curve, the clump it belongs to. */
    clumpIds?: Uint32Array;
}

export interface CurveGroup {
    name: string;
    strands: CurveSet;
    /** The curves a simulation drives and the strands follow; empty where the tool authored none. */
    guides: CurveSet;
}

export interface GroomCurves { groups: CurveGroup[] }

/** What the engine adds to a group: the Strands panel's settings. */
export interface GroomGroupSettings {
    /** The material the strands draw with, relative to the `.esgroom` as its curves are (or from the project's root); empty for the stock Strands material. */
    material: string;
    /** On: every strand is `hairWidth` wide. Off: each takes the width its curves carry. */
    overrideWidth: boolean;
    /** The strand's width, in centimetres, where `overrideWidth` is on. */
    hairWidth: number;
    /** A scale on the width at each root, interpolated to `hairTipScale` at the tip. */
    hairRootScale: number;
    hairTipScale: number;
    /** A scale on how much light a depth of strands takes: more is a darker, denser shadow inside the groom. */
    hairShadowDensity: number;
    /** Whether the strands cast shadows (on themselves and on what is under them). */
    castShadows: boolean;
    /** Draws each strand at least a pixel wide, with its coverage cut to the width it has, so sparse strands do not break into dashes. */
    stableRasterization: boolean;
}

/**
 * The groom's cards, its far level of detail: a mesh of hair cards and the material that draws them (both relative to the
 * `.esgroom`, as its curves file is). Where the groom covers less of the view's height than `screenSize` (0..1), the cards draw
 * in place of the strands. Create Hair Cards writes it.
 */
export interface GroomCardsLod {
    mesh: string;
    material: string;
    screenSize: number;
}

/** Where the cards take over when a groom does not say: a head of hair a fifth of the view's height. */
export const DEFAULT_CARDS_SCREEN_SIZE = 0.2;

export interface GroomDocument {
    version: number;
    type: 'groom';
    /** The `.escurves` file, relative to this one; empty where the groom is grown from `grow`. */
    curves: string;
    /** The parameters the groom is grown from in the engine (groomGrow.ts), in place of a curves file. */
    grow?: GrowRecipe;
    /** Its cards, drawn in place of the strands where the groom is small in the view. */
    cards?: GroomCardsLod;
    groups: GroomGroupSettings[];
}

function groomGrowth(raw: Partial<GroomDocument>): GrowRecipe | undefined {
    return raw.grow && typeof raw.grow === 'object' ? raw.grow : undefined;
}

function hasGroomCards(cards: Partial<GroomCardsLod> | undefined): cards is Partial<GroomCardsLod> & Pick<GroomCardsLod, 'mesh' | 'material'> {
    return !!cards && typeof cards.mesh === 'string' && !!cards.mesh && typeof cards.material === 'string' && !!cards.material;
}

/** Map the asset fields read by the groom, retaining the authored document's other fields. */
export function mapGroomAssetRefs(document: unknown, map: (ref: string) => string): void {
    const groom = document as Partial<GroomDocument> | null;
    if (groom?.type !== 'groom') return;
    if (!groomGrowth(groom) && typeof groom.curves === 'string' && groom.curves) groom.curves = map(groom.curves);
    if (hasGroomCards(groom.cards)) {
        groom.cards.mesh = map(groom.cards.mesh);
        groom.cards.material = map(groom.cards.material);
    }
    for (const group of Array.isArray(groom.groups) ? groom.groups : []) {
        if (typeof group?.material === 'string' && group.material) group.material = map(group.material);
    }
}

export const DEFAULT_GROUP_SETTINGS: Readonly<GroomGroupSettings> = Object.freeze({
    material: '',
    overrideWidth: true,
    hairWidth: 0.01,
    hairRootScale: 1,
    hairTipScale: 1,
    hairShadowDensity: 1,
    castShadows: true,
    stableRasterization: false,
});

/** A group's settings with every missing or malformed field at its default. */
export function groupSettings(raw: Partial<GroomGroupSettings> | undefined): GroomGroupSettings {
    const d = DEFAULT_GROUP_SETTINGS;
    const r = raw ?? {};
    const num = (v: unknown, fallback: number, min = 0): number => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fallback;
    return {
        material: typeof r.material === 'string' ? r.material : d.material,
        overrideWidth: typeof r.overrideWidth === 'boolean' ? r.overrideWidth : d.overrideWidth,
        hairWidth: num(r.hairWidth, d.hairWidth),
        hairRootScale: num(r.hairRootScale, d.hairRootScale),
        hairTipScale: num(r.hairTipScale, d.hairTipScale),
        hairShadowDensity: num(r.hairShadowDensity, d.hairShadowDensity),
        castShadows: typeof r.castShadows === 'boolean' ? r.castShadows : d.castShadows,
        stableRasterization: typeof r.stableRasterization === 'boolean' ? r.stableRasterization : d.stableRasterization,
    };
}

/** Reads a `.esgroom`, filling what it lacks. */
export function parseGroomDocument(text: string): GroomDocument {
    const raw = JSON.parse(text) as Partial<GroomDocument>;
    if (raw.type !== 'groom') throw new Error('not a groom: its "type" is not "groom"');
    const grow = groomGrowth(raw);
    const curves = typeof raw.curves === 'string' ? raw.curves : '';
    if (!curves && !grow) throw new Error('a groom names its curves file in "curves", or grows them from "grow"');
    const c = raw.cards;
    const cards = hasGroomCards(c)
        ? { mesh: c.mesh, material: c.material, screenSize: typeof c.screenSize === 'number' && Number.isFinite(c.screenSize) ? Math.max(0, c.screenSize) : DEFAULT_CARDS_SCREEN_SIZE }
        : undefined;
    return {
        version: typeof raw.version === 'number' ? raw.version : GROOM_FORMAT_VERSION,
        type: 'groom',
        curves,
        ...(grow ? { grow } : {}),
        ...(cards ? { cards } : {}),
        groups: Array.isArray(raw.groups) ? raw.groups.map((g) => groupSettings(g)) : [],
    };
}

/** The settings of every group the curves have: what the document says for the ones it names, the defaults for the rest. */
export function settingsForGroups(doc: GroomDocument, groupCount: number): GroomGroupSettings[] {
    const out: GroomGroupSettings[] = [];
    for (let i = 0; i < groupCount; i++) out.push(doc.groups[i] ?? groupSettings(undefined));
    return out;
}

class Reader {
    private at = 0;
    private readonly view: DataView;
    constructor(private readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
    private need(n: number): void { if (this.at + n > this.bytes.byteLength) throw new Error(`the curves file ends early: ${n} bytes wanted at ${this.at} of ${this.bytes.byteLength}`); }
    u16(): number { this.need(2); const v = this.view.getUint16(this.at, true); this.at += 2; return v; }
    u32(): number { this.need(4); const v = this.view.getUint32(this.at, true); this.at += 4; return v; }
    /** A copy, so an array starts where it must whatever the file's own alignment. */
    take(n: number): Uint8Array {
        this.need(n);
        // Copied into a buffer of its own: a Node Buffer's slice is a view of a shared pool, whose `.buffer` is not these bytes.
        const out = new Uint8Array(n);
        out.set(this.bytes.subarray(this.at, this.at + n));
        this.at += n;
        return out;
    }
    align4(): void { this.at = (this.at + 3) & ~3; }
}

function readSet(r: Reader): CurveSet {
    const curveCount = r.u32(), pointCount = r.u32(), flags = r.u32();
    const counts = new Uint16Array(r.take(curveCount * 2).buffer);
    r.align4();
    let sum = 0;
    for (let i = 0; i < curveCount; i++) {
        if (counts[i]! < 2) throw new Error(`curve ${i} has ${counts[i]} point(s); a curve needs two or more`);
        sum += counts[i]!;
    }
    if (sum !== pointCount) throw new Error(`the curves have ${sum} points between them and the header says ${pointCount}`);
    const set: CurveSet = {
        counts,
        positions: new Float32Array(r.take(pointCount * 12).buffer),
        radii: new Float32Array(r.take(pointCount * 4).buffer),
    };
    if (flags & CurveAttribute.RootUV) set.rootUV = new Float32Array(r.take(curveCount * 8).buffer);
    if (flags & CurveAttribute.Color) set.colors = r.take(pointCount * 4);
    if (flags & CurveAttribute.ClumpId) set.clumpIds = new Uint32Array(r.take(curveCount * 4).buffer);
    return set;
}

/** Reads a `.escurves` file. Throws, saying what is wrong, on one it cannot read. */
export function decodeCurves(data: ArrayBuffer | Uint8Array): GroomCurves {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const r = new Reader(bytes);
    if (r.u32() !== CURVES_MAGIC) throw new Error('not a curves file (its magic is not ESCV)');
    const version = r.u32();
    if (version !== CURVES_VERSION) throw new Error(`curves file version ${version}; this engine reads ${CURVES_VERSION}`);
    const groupCount = r.u32();
    const groups: CurveGroup[] = [];
    for (let g = 0; g < groupCount; g++) {
        const nameBytes = r.take(r.u16());
        r.align4();
        const name = new TextDecoder().decode(nameBytes);
        const strands = readSet(r);
        const guides = readSet(r);
        groups.push({ name, strands, guides });
    }
    return { groups };
}

class Writer {
    private parts: Uint8Array[] = [];
    private size = 0;
    private push(b: Uint8Array): void { this.parts.push(b); this.size += b.byteLength; }
    u16(v: number): void { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); this.push(b); }
    u32(v: number): void { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); this.push(b); }
    bytes(v: ArrayBufferView): void { this.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice()); }
    align4(): void { const pad = (4 - (this.size & 3)) & 3; if (pad) this.push(new Uint8Array(pad)); }
    finish(): Uint8Array {
        const out = new Uint8Array(this.size);
        let at = 0;
        for (const p of this.parts) { out.set(p, at); at += p.byteLength; }
        return out;
    }
}

function writeSet(w: Writer, set: CurveSet): void {
    const flags = (set.rootUV ? CurveAttribute.RootUV : 0) | (set.colors ? CurveAttribute.Color : 0) | (set.clumpIds ? CurveAttribute.ClumpId : 0);
    w.u32(set.counts.length); w.u32(set.radii.length); w.u32(flags);
    w.bytes(set.counts); w.align4();
    w.bytes(set.positions); w.bytes(set.radii);
    if (set.rootUV) w.bytes(set.rootUV);
    if (set.colors) w.bytes(set.colors);
    if (set.clumpIds) w.bytes(set.clumpIds);
}

/** Writes a `.escurves` file: what the Blender exporter writes, for tests and for tools that make grooms in code. */
export function encodeCurves(curves: GroomCurves): Uint8Array {
    const w = new Writer();
    w.u32(CURVES_MAGIC); w.u32(CURVES_VERSION); w.u32(curves.groups.length);
    for (const g of curves.groups) {
        const name = new TextEncoder().encode(g.name);
        w.u16(name.byteLength); w.bytes(name); w.align4();
        writeSet(w, g.strands);
        writeSet(w, g.guides);
    }
    return w.finish();
}

export const emptyCurveSet = (): CurveSet => ({ counts: new Uint16Array(0), positions: new Float32Array(0), radii: new Float32Array(0) });

/** What the Strands panel shows at the top of a group. */
export interface CurveSetStats {
    curves: number;
    points: number;
    /** The widest strand, in centimetres (twice the largest radius). */
    maxWidth: number;
    /** Points per curve. */
    minPoints: number;
    maxPoints: number;
    avgPoints: number;
}

export interface GroupStats {
    name: string;
    strands: CurveSetStats;
    guides: CurveSetStats;
    /** The attributes the strands carry, by name: 'Root UV', 'Color', 'Clump ID'. */
    attributes: string[];
}

export function curveSetStats(set: CurveSet): CurveSetStats {
    const n = set.counts.length;
    let min = n ? Infinity : 0, max = 0, maxR = 0;
    for (let i = 0; i < n; i++) { const c = set.counts[i]!; if (c < min) min = c; if (c > max) max = c; }
    for (let i = 0; i < set.radii.length; i++) if (set.radii[i]! > maxR) maxR = set.radii[i]!;
    return { curves: n, points: set.radii.length, maxWidth: maxR * 2 * 100, minPoints: min, maxPoints: max, avgPoints: n ? Math.round(set.radii.length / n) : 0 };
}

export function groupStats(group: CurveGroup): GroupStats {
    const attributes: string[] = [];
    if (group.strands.rootUV) attributes.push('Root UV');
    if (group.strands.colors) attributes.push('Color');
    if (group.strands.clumpIds) attributes.push('Clump ID');
    return { name: group.name, strands: curveSetStats(group.strands), guides: curveSetStats(group.guides), attributes };
}
