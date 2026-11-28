// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** A reusable .esterrainlayerinfo asset. */
export interface TerrainLayerInfo {
    name: string;
    blend: 'weight' | 'alpha';
    physicalMaterial: string;
    hardness: number;
}

/** The stored channel stays with its named layer when the material changes. */
export interface TerrainPaintBinding extends TerrainLayerInfo {
    slot: number;
    info: string;
    painted?: boolean;
}

export interface TerrainPaintTarget extends TerrainPaintBinding {
    materialIndex: number;
}

export const defaultTerrainLayers = ['grass', 'dirt', 'snow', 'rock'] as const;

export function terrainLayerName(path: string): string {
    return (path.split(/[\\/]/).pop() ?? '').replace(/\.esterrainlayer$/i, '');
}

export function parseTerrainLayerInfo(raw: unknown): TerrainLayerInfo {
    const d = raw as Partial<TerrainLayerInfo> | null;
    if (!d || typeof d.name !== 'string' || !d.name.trim() || (d.blend !== 'weight' && d.blend !== 'alpha')) {
        throw new Error('Invalid terrain layer information');
    }
    return { name: d.name.trim(), blend: d.blend, physicalMaterial: typeof d.physicalMaterial === 'string' ? d.physicalMaterial : '',
        hardness: Number.isFinite(d.hardness) ? Math.min(1, Math.max(0, d.hardness!)) : 0.5 };
}

/** Resolve material order to persistent storage slots, keeping detached painted channels reserved. */
export function terrainPaintTargets(layers: readonly string[], bindings: readonly TerrainPaintBinding[] = []): TerrainPaintTarget[] {
    const names = layers.length ? layers.slice(0, 8).map(terrainLayerName) : [...defaultTerrainLayers];
    const held = bindings.filter(b => Number.isInteger(b.slot) && b.slot >= 0 && b.slot < 8 && (b.painted || names.includes(b.name)));
    const used = new Set(held.map(b => b.slot));
    const rows: TerrainPaintTarget[] = [];
    for (const [materialIndex, name] of names.entries()) {
        if (!name || rows.some(r => r.name === name)) continue;
        const saved = held.find(b => b.name === name);
        let slot = saved?.slot ?? materialIndex;
        if (!saved && used.has(slot)) {
            slot = Array.from({ length: 8 }, (_, i) => i).find(i => !used.has(i)) ?? -1;
        }
        if (slot >= 0) used.add(slot);
        rows.push({ name, slot, info: layers.length ? '' : 'builtin:' + name, blend: 'weight', physicalMaterial: '', hardness: 0.5, ...saved, materialIndex });
    }
    for (const b of held) if (!names.includes(b.name)) rows.push({ ...b, materialIndex: -1 });
    return rows;
}

/** Convert stored independent opacity and base weights to contributions in material order. */
export function materialPaintWeights(raw: readonly number[], targets: readonly TerrainPaintTarget[]): number[] {
    const out = Array<number>(8);
    writeMaterialPaintWeights(raw, targets, out);
    return out;
}

/** First material with the greatest weight, or -1 for a missing or unusable sample. */
export function dominantTerrainLayer(weights: readonly number[] | null): number {
    if (!weights) return -1;
    let best = -1, max = -Infinity;
    for (let i = 0; i < weights.length; i++) {
        const weight = weights[i];
        if (weight === undefined || Number.isNaN(weight)) return -1;
        if (best < 0 || weight > max) { best = i; max = weight; }
    }
    return best;
}

/** Compose into a reusable eight-channel buffer, replacing all previous contributions. */
export function writeMaterialPaintWeights(raw: readonly number[], targets: readonly TerrainPaintTarget[], out: number[]): void {
    for (let i = 0; i < out.length; i++) out[i] = 0;
    let sum = 0, background = -1;
    for (const t of targets) {
        if (t.materialIndex < 0 || t.slot < 0 || t.blend === 'alpha') continue;
        if (background < 0) background = t.materialIndex;
        sum += out[t.materialIndex] = raw[t.slot] ?? 0;
    }
    if (sum > 0) for (let i = 0; i < out.length; i++) out[i] = out[i]! / sum;
    else if (background >= 0) out[background] = 1;
    for (const t of targets) {
        if (t.materialIndex < 0 || t.slot < 0 || t.blend !== 'alpha') continue;
        const alpha = Math.max(0, Math.min(1, raw[t.slot] ?? 0));
        for (let i = 0; i < out.length; i++) out[i] = out[i]! * (1 - alpha);
        out[t.materialIndex] = alpha;
    }
}

/** Procedural height/slope paint seeds the base group. Independent overlays start empty. */
export function initialPaintWeights(weights: readonly number[], targets?: readonly TerrainPaintTarget[]): readonly number[] {
    if (!targets?.length) return weights;
    const raw = Array<number>(8).fill(0);
    let sum = 0;
    for (const t of targets) if (t.materialIndex >= 0 && t.slot >= 0 && t.blend === 'weight') sum += raw[t.slot] = weights[t.slot] ?? 0;
    if (sum > 0) for (let i = 0; i < raw.length; i++) raw[i] = raw[i]! / sum;
    return raw;
}

/** Carry the rounding remainder so four procedural channels never gain a 256th byte. */
export function writeWeightBytes(pixels: Uint8Array, at: number, weights: readonly number[], first = 0): void {
    let sum = 0;
    for (let c = 0; c < 4; c++) {
        const was = Math.round(sum);
        sum += Math.min(1, Math.max(0, weights[first + c] ?? 0)) * 255;
        pixels[at + c] = Math.round(sum) - was;
    }
}

export interface TerrainPhysicalMaterial { friction: number; restitution: number }

export function parseTerrainPhysicalMaterial(raw: unknown): TerrainPhysicalMaterial {
    const m = raw as Partial<TerrainPhysicalMaterial> | null;
    if (!m || !Number.isFinite(m.friction) || !Number.isFinite(m.restitution)) throw new Error('Invalid physical material');
    return { friction: Math.max(0, m.friction!), restitution: Math.min(1, Math.max(0, m.restitution!)) };
}
