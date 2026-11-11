// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cardFormat.ts
 * @brief   `.esmeshcards`: the six axis views of a mesh the surface cache lights (docs/GI_LUMEN_DESIGN.md, 3.3).
 *
 * @details A card is an orthographic view of the mesh from outside along one of +-x, +-y, +-z: for each pixel the nearest surface that
 *          faces the viewer, as its depth from the mesh's bounding box, its normal, its colour and what it emits. The pixel grid
 *          spans the box face, so a card says nothing about where the mesh stands in the world: the instance's transform does.
 *
 *          Face order is +x, -x, +y, -y, +z, -z (`CARD_AXES`). The two axes a card's pixels run along are the other two, in order
 *          (for +-x: y then z; for +-y: x then z; for +-z: x then y); pixel (i, j) is centred at box min + (i + 0.5, j + 0.5) * cell there.
 */

export interface MeshCard {
    width: number;
    height: number;
    /** Depth from the box face the card looks in from, in 1/65535ths of the box's extent along the card's axis; 65535 = nothing here. */
    depth: Uint16Array;
    /** Unit normal, signed bytes (x, y, z) per pixel; /127. */
    normal: Int8Array;
    /** Linear albedo, bytes (r, g, b) per pixel. */
    albedo: Uint8Array;
    /** Emission, bytes (r, g, b) per pixel, times `MeshCards.emissiveScale` / 255. */
    emissive: Uint8Array;
}

export interface MeshCards {
    aabbMin: [number, number, number];
    aabbMax: [number, number, number];
    /** World size of one pixel the card was baked at. */
    cell: number;
    emissiveScale: number;
    /** +x, -x, +y, -y, +z, -z. */
    cards: MeshCard[];
}

export const NO_DEPTH = 65535;
/** Per face: the axis it looks along, the sign of the side it looks from, and the two axes its pixels run over. */
export const CARD_AXES: ReadonlyArray<{ axis: number; sign: 1 | -1; u: number; v: number }> = [
    { axis: 0, sign: 1, u: 1, v: 2 }, { axis: 0, sign: -1, u: 1, v: 2 },
    { axis: 1, sign: 1, u: 0, v: 2 }, { axis: 1, sign: -1, u: 0, v: 2 },
    { axis: 2, sign: 1, u: 0, v: 1 }, { axis: 2, sign: -1, u: 0, v: 1 },
];

export const MESH_CARDS_MAGIC = 0x44435345;  // 'ESCD'
const HEADER = 4 * (2 + 3 + 3 + 2);

export function encodeMeshCards(m: MeshCards): Uint8Array {
    let size = HEADER;
    for (const c of m.cards) size += 4 + c.width * c.height * (2 + 3 + 3 + 3);
    const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
    let o = 0;
    const u32 = (v: number) => { view.setUint32(o, v, true); o += 4; };
    const f32 = (v: number) => { view.setFloat32(o, v, true); o += 4; };
    u32(MESH_CARDS_MAGIC); u32(1);
    m.aabbMin.forEach(f32); m.aabbMax.forEach(f32);
    f32(m.cell); f32(m.emissiveScale);
    for (const c of m.cards) {
        view.setUint16(o, c.width, true); view.setUint16(o + 2, c.height, true); o += 4;
        for (let i = 0; i < c.depth.length; i++) view.setUint16(o + i * 2, c.depth[i]!, true);
        o += c.depth.length * 2;
        for (const plane of [c.normal, c.albedo, c.emissive]) {
            bytes.set(new Uint8Array(plane.buffer, plane.byteOffset, plane.byteLength), o);
            o += plane.byteLength;
        }
    }
    return bytes;
}

export function decodeMeshCards(bytes: Uint8Array): MeshCards {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < HEADER || view.getUint32(0, true) !== MESH_CARDS_MAGIC) throw new Error('not a mesh card file');
    if (view.getUint32(4, true) !== 1) throw new Error(`unsupported mesh card file version ${view.getUint32(4, true)}`);
    const f = (at: number) => view.getFloat32(at, true);
    const aabbMin: [number, number, number] = [f(8), f(12), f(16)], aabbMax: [number, number, number] = [f(20), f(24), f(28)];
    const cell = f(32), emissiveScale = f(36);
    let o = HEADER;
    const cards: MeshCard[] = [];
    for (let k = 0; k < 6; k++) {
        if (o + 4 > bytes.byteLength) throw new Error('mesh card file is truncated');
        const width = view.getUint16(o, true), height = view.getUint16(o + 2, true);
        o += 4;
        const n = width * height;
        if (o + n * 11 > bytes.byteLength) throw new Error('mesh card file is truncated');
        const depth = new Uint16Array(n);
        for (let i = 0; i < n; i++) depth[i] = view.getUint16(o + i * 2, true);
        o += n * 2;
        const normal = new Int8Array(bytes.slice(o, o + n * 3).buffer); o += n * 3;
        const albedo = bytes.slice(o, o + n * 3); o += n * 3;
        const emissive = bytes.slice(o, o + n * 3); o += n * 3;
        cards.push({ width, height, depth, normal, albedo, emissive });
    }
    return { aabbMin, aabbMax, cell, emissiveScale, cards };
}

/** The card pixel of face `face` that a local-space point falls in, or null outside the box; with the depth of that point from the card's plane. */
export function cardPixel(m: MeshCards, face: number, p: readonly [number, number, number]): { x: number; y: number; depth: number } | null {
    const { axis, sign, u, v } = CARD_AXES[face]!, card = m.cards[face]!;
    const extent = m.aabbMax[axis]! - m.aabbMin[axis]!;
    const fu = (p[u]! - m.aabbMin[u]!) / (m.aabbMax[u]! - m.aabbMin[u]! || 1), fv = (p[v]! - m.aabbMin[v]!) / (m.aabbMax[v]! - m.aabbMin[v]! || 1);
    if (fu < 0 || fu >= 1 || fv < 0 || fv >= 1) return null;
    const depth = sign > 0 ? m.aabbMax[axis]! - p[axis]! : p[axis]! - m.aabbMin[axis]!;
    return { x: Math.min(Math.floor(fu * card.width), card.width - 1), y: Math.min(Math.floor(fv * card.height), card.height - 1), depth: depth / (extent || 1) };
}
