// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    surfaceCache.ts
 * @brief   The scene's surfaces with the light on them, kept per card pixel: what a ray that hits a surface brings back (docs/GI_LUMEN_DESIGN.md, 3.3).
 *
 * @details An instance is a mesh's cards (`.esmeshcards`) placed in the world. Lighting a card pixel is: the sun's direct light, gated by the
 *          scene's distance field (so a wall shadows what is behind it with no shadow map in the cache), plus an indirect term handed in
 *          by the caller (the previous frame's gather: that is how the cache converges on many bounces), times the albedo, plus the emission.
 *          Radiance is in the engine's units for a diffuse surface: albedo times the irradiance over pi, so a surface facing a sun of
 *          intensity I reads albedo * I.
 *
 *          A ray's hit is looked up by `lookup`: the point where the distance field stopped it and the direction it came in, answered by
 *          the cards that face the ray, blended by how squarely they face it.
 *
 *          This is the reference the GPU refresh follows; it runs on the CPU in tests and in tools.
 */
import { CARD_AXES, NO_DEPTH, cardPixel, type MeshCards } from './cardFormat';
import type { GlobalSdf } from './globalSdf';

export interface CardInstance {
    id: number;
    cards: MeshCards;
    /** Column-major 4x4, local to world: rotation, translation, one uniform scale. */
    worldFromLocal: ArrayLike<number>;
}

export interface SunLight {
    /** Unit vector toward the sun. */
    toLight: readonly [number, number, number];
    /** Colour times intensity: the radiance a surface facing the sun gives per unit albedo. */
    radiance: readonly [number, number, number];
}

export interface LightOptions {
    sun?: SunLight;
    /** Shadows from the scene distance field; the sun is unshadowed without it. */
    sdf?: GlobalSdf;
    /** How far a shadow ray looks. */
    shadowRange?: number;
    /** Extra light per surface point, to be multiplied by the albedo: the indirect term. Receives the world position and unit normal. */
    indirect?: (position: [number, number, number], normal: [number, number, number]) => readonly [number, number, number];
    /** How far off the surface a shadow ray starts, in world units; must clear the growth of the distance field. */
    bias?: number;
}

interface Placed {
    instance: CardInstance;
    scale: number;
    inverse: Float64Array;
    /** Per card pixel, linear RGB: what the surface gives out. */
    radiance: Float32Array[];
    min: [number, number, number];
    max: [number, number, number];
}

export class SurfaceCache {
    private placed_ = new Map<number, Placed>();

    add(instance: CardInstance): void {
        const m = instance.worldFromLocal, scale = Math.hypot(m[0]!, m[1]!, m[2]!);
        const r = [0, 1, 2].map((c) => [0, 1, 2].map((row) => m[c * 4 + row]! / scale));
        const inverse = new Float64Array(16);
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) inverse[col * 4 + row] = r[row]![col]! / scale;
            inverse[12 + row] = -(r[row]![0]! * m[12]! + r[row]![1]! * m[13]! + r[row]![2]! * m[14]!) / scale;
        }
        inverse[15] = 1;
        const { cards } = instance;
        const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        for (let c = 0; c < 8; c++) {
            const l = [c & 1 ? cards.aabbMax[0] : cards.aabbMin[0], c & 2 ? cards.aabbMax[1] : cards.aabbMin[1], c & 4 ? cards.aabbMax[2] : cards.aabbMin[2]];
            for (let k = 0; k < 3; k++) {
                const w = m[k]! * l[0]! + m[4 + k]! * l[1]! + m[8 + k]! * l[2]! + m[12 + k]!;
                min[k] = Math.min(min[k], w); max[k] = Math.max(max[k], w);
            }
        }
        this.placed_.set(instance.id, { instance, scale, inverse, radiance: cards.cards.map((c) => new Float32Array(c.width * c.height * 3)), min, max });
    }

    remove(id: number): void { this.placed_.delete(id); }

    /** The radiance of one card pixel as last lit (tests and tools). */
    radianceAt(id: number, face: number, x: number, y: number): [number, number, number] | null {
        const placed = this.placed_.get(id);
        if (!placed) return null;
        const card = placed.instance.cards.cards[face]!, i = x + y * card.width;
        if (card.depth[i] === NO_DEPTH) return null;
        const r = placed.radiance[face]!;
        return [r[i * 3]!, r[i * 3 + 1]!, r[i * 3 + 2]!];
    }

    /** The world position and unit normal of a card pixel, or null where it holds no surface. */
    private pixelSurface_(placed: Placed, face: number, x: number, y: number): { position: [number, number, number]; normal: [number, number, number] } | null {
        const { cards } = placed.instance, card = cards.cards[face]!, i = x + y * card.width;
        if (card.depth[i] === NO_DEPTH) return null;
        const { axis, sign, u, v } = CARD_AXES[face]!;
        const local: [number, number, number] = [0, 0, 0];
        local[u] = cards.aabbMin[u]! + ((x + 0.5) / card.width) * (cards.aabbMax[u]! - cards.aabbMin[u]!);
        local[v] = cards.aabbMin[v]! + ((y + 0.5) / card.height) * (cards.aabbMax[v]! - cards.aabbMin[v]!);
        const depth = (card.depth[i]! / 65534) * (cards.aabbMax[axis]! - cards.aabbMin[axis]!);
        local[axis] = sign > 0 ? cards.aabbMax[axis]! - depth : cards.aabbMin[axis]! + depth;
        const m = placed.instance.worldFromLocal;
        const position = [0, 1, 2].map((k) => m[k]! * local[0] + m[4 + k]! * local[1] + m[8 + k]! * local[2] + m[12 + k]!) as [number, number, number];
        const n = [card.normal[i * 3]! / 127, card.normal[i * 3 + 1]! / 127, card.normal[i * 3 + 2]! / 127];
        const nl = Math.hypot(...n) || 1;
        const normal = [0, 1, 2].map((k) => (m[k]! * n[0]! + m[4 + k]! * n[1]! + m[8 + k]! * n[2]!) / (placed.scale * nl)) as [number, number, number];
        return { position, normal };
    }

    /** Refreshes every card pixel's radiance. */
    light(options: LightOptions): void {
        const range = options.shadowRange ?? 500, bias = options.bias ?? 0.3;
        for (const placed of this.placed_.values()) {
            const { cards } = placed.instance;
            cards.cards.forEach((card, face) => {
                for (let y = 0; y < card.height; y++) for (let x = 0; x < card.width; x++) {
                    const i = x + y * card.width, out = placed.radiance[face]!;
                    const s = this.pixelSurface_(placed, face, x, y);
                    if (!s) { out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = 0; continue; }
                    const light = [0, 0, 0];
                    const sun = options.sun;
                    if (sun) {
                        const ndl = s.normal[0] * sun.toLight[0] + s.normal[1] * sun.toLight[1] + s.normal[2] * sun.toLight[2];
                        if (ndl > 0) {
                            const origin: [number, number, number] = [s.position[0] + s.normal[0] * bias, s.position[1] + s.normal[1] * bias, s.position[2] + s.normal[2] * bias];
                            const blocked = options.sdf ? options.sdf.sphereTrace(origin, sun.toLight as [number, number, number], range) !== null : false;
                            if (!blocked) for (let k = 0; k < 3; k++) light[k] += sun.radiance[k]! * ndl;
                        }
                    }
                    if (options.indirect) {
                        const g = options.indirect(s.position, s.normal);
                        for (let k = 0; k < 3; k++) light[k] += g[k]!;
                    }
                    for (let k = 0; k < 3; k++) {
                        out[i * 3 + k] = (card.albedo[i * 3 + k]! / 255) * light[k]! + (card.emissive[i * 3 + k]! / 255) * cards.emissiveScale;
                    }
                }
            });
        }
    }

    /**
     * What a ray brings back from the surface it hit at `point`, travelling along unit `dir`: the radiance of the cards that face it,
     * blended by how squarely each does, from the pixel whose surface is within `tolerance` of the point. Null when no card sees it.
     */
    lookup(point: readonly [number, number, number], dir: readonly [number, number, number], tolerance: number): [number, number, number] | null {
        // Of the instances whose cards hold the point, the one whose surface it is nearest to.
        let best: [number, number, number] | null = null, bestError = Infinity;
        for (const placed of this.placed_.values()) {
            let near = true;
            for (let k = 0; k < 3; k++) if (point[k]! < placed.min[k]! - tolerance || point[k]! > placed.max[k]! + tolerance) { near = false; break; }
            if (!near) continue;
            const i = placed.inverse;
            const local = [0, 1, 2].map((k) => i[k]! * point[0]! + i[4 + k]! * point[1]! + i[8 + k]! * point[2]! + i[12 + k]!) as [number, number, number];
            const d = [0, 1, 2].map((k) => i[k]! * dir[0]! + i[4 + k]! * dir[1]! + i[8 + k]! * dir[2]!);
            const dl = Math.hypot(...d) || 1;
            const { cards } = placed.instance;
            const sum = [0, 0, 0];
            let total = 0, error = 0;
            for (let axis = 0; axis < 3; axis++) {
                const weight = Math.abs(d[axis]! / dl);
                if (weight < 0.05) continue;
                // The face the ray looks at: the one on the side it came from.
                const face = axis * 2 + (d[axis]! > 0 ? 1 : 0);
                // The point must stand over the card (within a pixel of its edge); a card does not speak for what lies past its rim.
                const clamped: [number, number, number] = [local[0], local[1], local[2]];
                const { u, v } = CARD_AXES[face]!;
                let over = true;
                for (const k of [u, v]) {
                    if (local[k]! < cards.aabbMin[k]! - cards.cell || local[k]! > cards.aabbMax[k]! + cards.cell) over = false;
                    clamped[k] = Math.min(Math.max(local[k]!, cards.aabbMin[k]!), cards.aabbMax[k]! - 1e-9);
                }
                if (!over) continue;
                clamped[axis] = local[axis]!;
                const px = cardPixel(cards, face, clamped);
                if (!px) continue;
                const card = cards.cards[face]!, idx = px.x + px.y * card.width;
                if (card.depth[idx] === NO_DEPTH) continue;
                const ext = cards.aabbMax[axis]! - cards.aabbMin[axis]!;
                const cardDepth = (card.depth[idx]! / 65534) * ext;
                const pointDepth = px.depth * ext;
                const off = Math.abs(cardDepth - pointDepth) * placed.scale;
                if (off > tolerance) continue;
                error = Math.max(error, off);
                const r = placed.radiance[face]!;
                for (let k = 0; k < 3; k++) sum[k] += weight * r[idx * 3 + k]!;
                total += weight;
            }
            if (total > 0 && error < bestError) { bestError = error; best = [sum[0]! / total, sum[1]! / total, sum[2]! / total]; }
        }
        return best;
    }
}
