// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { landscapeSpans, type LandscapeSpline, type LandscapeSpan } from './landscapeSpline';
import type { GroundEdit } from './groundEdit';
import type { TiledGroundEdit } from './tiledGroundEdit';
import { SculptMode, type Brush, type LandscapeSample } from './sculpt';

interface Piece {
    span: LandscapeSpan;
    t0: number;
    t1: number;
    x: number;
    z: number;
    dx: number;
    dz: number;
    len2: number;
}
const fade = (d: number, extent: number) => (d <= 0 ? 1 : extent <= 0 || d >= extent ? 0 : (1 + Math.cos((Math.PI * d) / extent)) / 2);

/** Disjoint rectangles over the corridor. Each height or weight is blended once, including at bends and junctions. */
export function landscapeGradeBrushes(
    graph: LandscapeSpline,
    ground: Pick<GroundEdit, 'minHeight' | 'maxHeight' | 'origin' | 'area' | 'samplesX' | 'samplesZ'>,
): Brush[] {
    const { sizeX, sizeZ } = ground.area;
    const cell = Math.max(sizeX / Math.max(1, ground.samplesX - 1), sizeZ / Math.max(1, ground.samplesZ - 1), 0.001);
    const block = 64 * cell;
    const degree = new Map<number, number>();
    for (const s of graph.segments) for (const e of [s.start, s.end]) degree.set(e.point, (degree.get(e.point) ?? 0) + 1);
    const bins = new Map<string, { x: number; z: number; pieces: Piece[] }>();
    for (const span of landscapeSpans(graph)) {
        const { a, b } = span;
        const pad = Math.max(a.width / 2 + a.sideFalloff, b.width / 2 + b.sideFalloff) + Math.max(a.endFalloff, b.endFalloff);
        const steps = Math.max(16, Math.min(2048, Math.ceil(span.curve.length / Math.max(cell * 2, Math.min(a.width, b.width) / 4))));
        let p = a as { x: number; z: number };
        for (let i = 1; i <= steps; i++) {
            const q = span.at(i / steps),
                dx = q.x - p.x,
                dz = q.z - p.z;
            const piece = { span, t0: (i - 1) / steps, t1: i / steps, x: p.x, z: p.z, dx, dz, len2: dx * dx + dz * dz };
            const left = Math.max(-sizeX / 2, Math.min(p.x, q.x) - pad),
                right = Math.min(sizeX / 2, Math.max(p.x, q.x) + pad);
            const back = Math.max(-sizeZ / 2, Math.min(p.z, q.z) - pad),
                front = Math.min(sizeZ / 2, Math.max(p.z, q.z) + pad);
            for (let z = Math.floor(back / block); z <= Math.floor(front / block); z++)
                for (let x = Math.floor(left / block); x <= Math.floor(right / block); x++) {
                    const key = x + ':' + z;
                    if (!bins.has(key)) bins.set(key, { x, z, pieces: [] });
                    bins.get(key)!.pieces.push(piece);
                }
            p = q;
        }
    }
    return Array.from(bins.values(), (bin) => {
        const x = (bin.x + 0.5) * block,
            z = (bin.z + 0.5) * block,
            half = block / 2;
        const groups = new Map<LandscapeSpan, Piece[]>();
        for (const piece of bin.pieces) {
            if (!groups.has(piece.span)) groups.set(piece.span, []);
            groups.get(piece.span)!.push(piece);
        }
        return {
            x: ground.origin.x + x,
            z: ground.origin.z + z,
            radius: half,
            component: { halfX: half, halfZ: half },
            falloff: 0,
            landscape: (dx: number, dz: number): LandscapeSample | null => {
                const px = x + dx,
                    pz = z + dz;
                if (Math.floor(px / block) !== bin.x || Math.floor(pz / block) !== bin.z) return null;
                let best: LandscapeSample | null = null,
                    bestDistance = Infinity;
                for (const [span, pieces] of groups) {
                    let p: Piece | undefined,
                        along = 0,
                        u = 0,
                        distance = Infinity;
                    for (const piece of pieces) {
                        if (piece.len2 < 1e-12) continue;
                        const offset = ((px - piece.x) * piece.dx + (pz - piece.z) * piece.dz) / piece.len2;
                        const fraction = Math.max(0, Math.min(1, offset));
                        const d = Math.hypot(px - piece.x - fraction * piece.dx, pz - piece.z - fraction * piece.dz);
                        if (d < distance) {
                            p = piece;
                            along = offset;
                            u = fraction;
                            distance = d;
                        }
                    }
                    if (!p) continue;
                    const t = p.t0 + u * (p.t1 - p.t0);
                    const { a, b, segment } = span;
                    const cap = t === 0 ? a : t === 1 ? b : null;
                    const terminal = cap && degree.get(cap.id) === 1;
                    const outside = terminal ? Math.abs(along - u) * Math.sqrt(p.len2) : 0;
                    // Width and the terminal cap are independent in the cross-road and along-road directions.
                    const lateral = terminal ? Math.abs((px - p.x) * p.dz - (pz - p.z) * p.dx) / Math.sqrt(p.len2) : distance;
                    const width = a.width + (b.width - a.width) * t,
                        side = a.sideFalloff + (b.sideFalloff - a.sideFalloff) * t;
                    const weight = fade(lateral - width / 2, side) * fade(outside, cap?.endFalloff ?? 0);
                    if (weight <= 0 || (best && (weight < best.weight || (weight === best.weight && distance >= bestDistance))))
                        continue;
                    const nearStart = t * span.curve.length,
                        nearEnd = (1 - t) * span.curve.length;
                    const point = cap ?? (nearStart <= a.width / 2 && nearStart <= nearEnd ? a : nearEnd <= b.width / 2 ? b : null);
                    const rules = point ?? segment;
                    bestDistance = distance;
                    best = {
                        weight,
                        height: (p.span.at(t).y - ground.minHeight) / Math.max(ground.maxHeight - ground.minHeight, 1e-6),
                        raise: segment.raise && rules.raise,
                        lower: segment.lower && rules.lower,
                        layer: point && point.layer >= 0 ? point.layer : segment.layer,
                    };
                }
                return best;
            },
        };
    });
}

/** Apply to an already open ground transaction. The caller owns undo and saving. */
export function gradeLandscapeGround(ground: GroundEdit | TiledGroundEdit, graph: LandscapeSpline, brushes: readonly Brush[]): void {
    const highest = [...graph.points, ...graph.segments].reduce((layer, p) => Math.max(layer, p.layer), -1);
    for (const b of brushes) {
        ground.sculpt(SculptMode.Flatten, b.x, b.z, b.radius, 0, 1, 0, b);
        if (highest >= 0) ground.paint(highest, b.x, b.z, b.radius, 0, 1, false, b);
    }
}
