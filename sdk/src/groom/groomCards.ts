// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  groomCards.ts — hair cards made from a groom: a ribbon along each guide, for the strands textures to be baked onto.
 *
 *        A card follows its guide from root to tip, as wide as a lock, turned to face out from the head (across the strand and square
 *        to the line from the head's middle), narrowing toward the tip. Every card has a cell of its own in the UV square, its width
 *        across u and its length down v (the root at the top), the cells laid out so each is as tall against its width as the cards
 *        are long against theirs allows. Baking the strands textures onto these cards (trace both ways, a reach of about the space
 *        between two cards) and drawing them with the Hair material the bake writes is a groom drawn as cards: a far level of detail,
 *        or hair for a device that does not draw strands.
 */
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import type { CurveSet, GroomCurves, GroomGroupSettings } from './groomFormat';
import { STRANDS_SHADER_TEMPLATE } from './groomShader';
import { groupUniforms } from './groomPlugin';

export interface GroomCardsOptions {
    /** The width of a card at its root, in metres. */
    width?: number;
    /** Its width at the tip, as a share of the root's. */
    tipWidth?: number;
    /** Quads along each card. */
    segments?: number;
    /** The groups whose guides become cards; absent, all. Groups without guides use every so many strands instead. */
    groups?: number[];
    /** The point cards turn to face away from (the head's middle), in metres; default the middle of the guides' roots. */
    center?: [number, number, number];
    /** Cards a group at most, where it has no guides and its strands are thinned to make them. */
    maxCards?: number;
    /** World units a metre: the mesh is made in the scene's units, as a mesh of the scene is. */
    unitsPerMeter?: number;
}

/** A polyline's point at `s` of its length, into `out`. */
function along(p: Float32Array, first: number, n: number, cum: Float64Array, s: number, out: number[]): void {
    let k = 1;
    while (k < n - 1 && cum[k]! < s) k++;
    const span = cum[k]! - cum[k - 1]!;
    const t = span > 0 ? Math.min(1, Math.max(0, (s - cum[k - 1]!) / span)) : 0;
    for (let c = 0; c < 3; c++) out[c] = p[(first + k - 1) * 3 + c]! + (p[(first + k) * 3 + c]! - p[(first + k - 1) * 3 + c]!) * t;
}

/** The spines the cards follow: each group's guides, or its strands thinned to `maxCards` where it has none. */
function spinesOf(curves: GroomCurves, groups: number[] | undefined, maxCards: number): { set: CurveSet; curve: number; first: number }[] {
    const out: { set: CurveSet; curve: number; first: number }[] = [];
    curves.groups.forEach((g, gi) => {
        if (groups?.length && !groups.includes(gi)) return;
        const set = g.guides.counts.length ? g.guides : g.strands;
        const step = set === g.guides ? 1 : Math.max(1, Math.ceil(set.counts.length / maxCards));
        let first = 0;
        for (let c = 0; c < set.counts.length; c++) {
            if (c % step === 0) out.push({ set, curve: c, first });
            first += set.counts[c]!;
        }
    });
    return out;
}

/** Cards along a groom's guides, as a mesh in the scene's units: positions, normals (out of the card's face) and a UV cell a card. */
export function buildGroomCards(curves: GroomCurves, opts: GroomCardsOptions = {}): MeshData {
    const width = opts.width ?? 0.025, tipShare = opts.tipWidth ?? 0.5, segs = Math.max(1, Math.round(opts.segments ?? 12));
    const scale = opts.unitsPerMeter ?? 100;
    const spines = spinesOf(curves, opts.groups, opts.maxCards ?? 600);
    if (spines.length === 0) throw new Error('the groom has no curves to make cards along');
    let center = opts.center;
    if (!center) {
        const c = [0, 0, 0];
        for (const s of spines) for (let k = 0; k < 3; k++) c[k] += s.set.positions[s.first * 3 + k]!;
        center = [c[0]! / spines.length, c[1]! / spines.length, c[2]! / spines.length];
    }
    // The cells: as many columns as make a cell's height against its width nearest the cards' own length against width.
    let meanLen = 0;
    const lengths = spines.map((s) => {
        const n = s.set.counts[s.curve]!;
        let l = 0;
        for (let k = 1; k < n; k++) {
            const a = (s.first + k - 1) * 3, b = (s.first + k) * 3;
            l += Math.hypot(s.set.positions[b]! - s.set.positions[a]!, s.set.positions[b + 1]! - s.set.positions[a + 1]!, s.set.positions[b + 2]! - s.set.positions[a + 2]!);
        }
        meanLen += l;
        return l;
    });
    meanLen /= spines.length;
    const aspect = Math.max(1, meanLen / width);
    const cols = Math.max(1, Math.min(spines.length, Math.round(Math.sqrt(spines.length * aspect))));
    const rows = Math.ceil(spines.length / cols);
    const pad = 0.08;

    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
    ]);
    const at = (sem: number): number => channels.find((c) => c.semantic === sem)!.offset / 4;
    const P = at(MeshChannel.Position), N = at(MeshChannel.Normal), UV = at(MeshChannel.TexCoord0), stride4 = vertexStride / 4;
    const perCard = (segs + 1) * 2;
    const vertexCount = spines.length * perCard;
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const f32 = new Float32Array(vertices.buffer);
    const indices = new Uint32Array(spines.length * segs * 6);
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const p = [0, 0, 0], q = [0, 0, 0], r = [0, 0, 0];
    let ix = 0;
    spines.forEach((s, i) => {
        const n = s.set.counts[s.curve]!;
        const cum = new Float64Array(n);
        for (let k = 1; k < n; k++) {
            const a = (s.first + k - 1) * 3, b = (s.first + k) * 3;
            cum[k] = cum[k - 1]! + Math.hypot(s.set.positions[b]! - s.set.positions[a]!, s.set.positions[b + 1]! - s.set.positions[a + 1]!, s.set.positions[b + 2]! - s.set.positions[a + 2]!);
        }
        const L = lengths[i]!;
        const cu = (i % cols) / cols, cv = Math.floor(i / cols) / rows;
        const cw = 1 / cols, ch = 1 / rows;
        for (let k = 0; k <= segs; k++) {
            const t = k / segs;
            along(s.set.positions, s.first, n, cum, t * L, p);
            // The strand's direction here: from a little before to a little after, one-sided at the ends.
            const d = L / segs * 0.5;
            along(s.set.positions, s.first, n, cum, Math.max(0, t * L - d), q);
            along(s.set.positions, s.first, n, cum, Math.min(L, t * L + d), r);
            let tx = r[0]! - q[0]!, ty = r[1]! - q[1]!, tz = r[2]! - q[2]!;
            const tl = Math.hypot(tx, ty, tz) || 1;
            tx /= tl; ty /= tl; tz /= tl;
            // Out from the head's middle, flat to the strand: the card's face looks along it, and its width lies across both.
            let ox = p[0]! - center![0], oy = p[1]! - center![1], oz = p[2]! - center![2];
            const od = ox * tx + oy * ty + oz * tz;
            ox -= tx * od; oy -= ty * od; oz -= tz * od;
            let ol = Math.hypot(ox, oy, oz);
            if (ol < 1e-6) { ox = 0; oy = 0; oz = 1; ol = 1; }
            ox /= ol; oy /= ol; oz /= ol;
            const sx = ty * oz - tz * oy, sy = tz * ox - tx * oz, sz = tx * oy - ty * ox;
            const half = (width * (1 - (1 - tipShare) * t)) / 2;
            for (let e = 0; e < 2; e++) {
                const sign = e === 0 ? -1 : 1;
                const v = i * perCard + k * 2 + e, o = v * stride4;
                const x = (p[0]! + sx * half * sign) * scale, y = (p[1]! + sy * half * sign) * scale, z = (p[2]! + sz * half * sign) * scale;
                f32[o + P] = x; f32[o + P + 1] = y; f32[o + P + 2] = z;
                f32[o + N] = ox; f32[o + N + 1] = oy; f32[o + N + 2] = oz;
                // Across the cell's width (inside its padding), and down it from the root at the top.
                f32[o + UV] = cu + cw * (pad + (1 - 2 * pad) * e);
                f32[o + UV + 1] = cv + ch * (1 - pad - (1 - 2 * pad) * t);
                if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
                if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
            }
            if (k < segs) {
                const a = i * perCard + k * 2;
                // Counter-clockwise seen from the side the card faces (its normal, out from the head).
                indices[ix++] = a; indices[ix++] = a + 1; indices[ix++] = a + 2;
                indices[ix++] = a + 1; indices[ix++] = a + 3; indices[ix++] = a + 2;
            }
        }
    });
    return { channels, vertexStride, vertexCount, vertices, indices, aabbMin: min, aabbMax: max };
}

/** The Strands shader's params a card is lit with too: the strand lobes, light through the strands, the strand's own diffuse. */
const SHARED_LOOK = ['u_roughness', 'u_specular', 'u_lobeGain', 'u_shiftPrimary', 'u_shiftSecondary', 'u_secondaryTint', 'u_translucency', 'u_strandDiffuse'] as const;

/** The colours a groom's strands carry at the root and at the tip, averaged, sRGB 0..1; white where they carry none. */
export function strandColours(curves: GroomCurves, groups?: number[]): { root: number[]; tip: number[] } {
    const root = [0, 0, 0], tip = [0, 0, 0];
    let n = 0;
    curves.groups.forEach((g, i) => {
        if (groups?.length && !groups.includes(i)) return;
        const set = g.strands;
        if (!set.colors) return;
        let first = 0;
        for (let c = 0; c < set.counts.length; c++) {
            const last = first + set.counts[c]! - 1;
            for (let k = 0; k < 3; k++) { root[k] += set.colors[first * 4 + k]! / 255; tip[k] += set.colors[last * 4 + k]! / 255; }
            n++;
            first = last + 1;
        }
    });
    if (n === 0) return { root: [1, 1, 1], tip: [1, 1, 1] };
    return { root: root.map((v) => v / n), tip: tip.map((v) => v / n) };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * What a Hair material drawing a groom's cards sets, so the cards look like the strands they stand in for: lit as strands are
 * (u_strandNormal 1: the shared strand look, and the Strands shader's own defaults for every lobe, for light through the hair and for
 * the darkening toward the root), shadowed with the density the groom's strands are, in their colours (the tip's as the tint, the
 * root's as a share of it), and cut from the baked coverage. Textures not included.
 */
export function cardsMaterialProperties(curves: GroomCurves, settings: GroomGroupSettings, unitsPerMeter: number, groups?: number[]): Record<string, unknown> {
    const strands = STRANDS_SHADER_TEMPLATE.defaults as Record<string, unknown>;
    const look: Record<string, unknown> = {};
    for (const key of SHARED_LOOK) if (key in strands) look[key] = strands[key];
    const { root, tip } = strandColours(curves, groups);
    // The root's colour as a share of the tip's, for the Hair shader to mix toward along the strand as the strands' own colours do.
    const share = root.map((v, k) => r3(Math.min(1, v / Math.max(tip[k]!, 1e-3))));
    return {
        ...look,
        u_strandNormal: 1,
        u_tint: { r: r3(tip[0]!), g: r3(tip[1]!), b: r3(tip[2]!), a: 1 },
        u_rootColor: { r: share[0]!, g: share[1]!, b: share[2]!, a: 1 },
        u_rootDark: typeof strands.u_rootDark === 'number' ? strands.u_rootDark : 0,
        u_occlusionStrength: 0,
        u_hairShadow: r3(groupUniforms(settings, 0, unitsPerMeter).u_hairShadow!),
        u_alphaCutoff: 0.35,
        u_tipSoftness: 0.25,
        // The strands' own shadow darkens the layers under others; the depth map adds only a touch of it, where cards hide strands.
        u_depthShade: 0.15,
        u_strandTone: 0.1,
        u_strandShift: 0.15,
    };
}
