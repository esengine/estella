// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { packWaterMesh, oceanReach } from './waterMesh';
import type { MeshData } from '../asset/meshFormat';
import type { WaterField, WaterZoneData } from './zone';

export interface TileLayout {
    tile: number;
    divisions: number;
    halfX: number;
    halfZ: number;
    lodScale: number;
    collapse: number;
}
export interface WaterTile {
    x: number;
    z: number;
    level: number;
}
type Coverage = 'wet' | 'dry' | 'mixed';
type Eye = readonly [number, number, number];

/** Resolve a WaterZone into a base tile size and independent half-extents in the XZ plane. */
export function waterTileLayout(zone: WaterZoneData): TileLayout {
    const divisions = 2 ** Math.max(1, Math.min(6, Math.round(zone.tessellationFactor ?? 3)));
    const tile = zone.tileSize > 0 ? zone.tileSize : Math.max(zone.cellSize, 1e-4) * divisions;
    const legacy = Math.max(1, Math.ceil(oceanReach(zone.cells, zone.rings, zone.cellSize) / tile));
    const count = (v: number) => Math.max(1, Math.min(256, Math.round(v > 0 ? v : legacy)));
    return {
        tile,
        divisions,
        halfX: count(zone.extentInTiles?.x),
        halfZ: count(zone.extentInTiles?.y),
        lodScale: Math.max(0.5, Math.min(zone.lodScale ?? 1, 4)),
        collapse: zone.forceCollapseDensityLevel ?? -1,
    };
}

/** Summed wet texels. A rectangle query includes its bilinear neighbours and the whole swash band. */
export function waterCoverage(field: WaterField, swash: number) {
    const { minX, minZ, sizeX, sizeZ, nx, nz } = field.grid;
    const stride = nx + 1;
    const bits = new Uint32Array(stride * (nz + 1));
    for (let j = 0; j < nz; j++) {
        let row = 0;
        for (let i = 0; i < nx; i++) {
            if (field.shore[j * nx + i]! >= -swash) row++;
            bits[(j + 1) * stride + i + 1] = bits[j * stride + i + 1]! + row;
        }
    }
    return (x: number, z: number, span: number): Coverage => {
        const outside = field.ocean ? 'wet' : 'dry';
        if (nx < 2 || nz < 2 || x > minX + sizeX || z > minZ + sizeZ || x + span < minX || z + span < minZ) return outside;
        const i0 = Math.max(0, Math.floor(((x - minX) / sizeX) * (nx - 1))),
            i1 = Math.min(nx - 1, Math.ceil(((x + span - minX) / sizeX) * (nx - 1))) + 1;
        const j0 = Math.max(0, Math.floor(((z - minZ) / sizeZ) * (nz - 1))),
            j1 = Math.min(nz - 1, Math.ceil(((z + span - minZ) / sizeZ) * (nz - 1))) + 1;
        const sum = bits[j1 * stride + i1]! - bits[j1 * stride + i0]! - bits[j0 * stride + i1]! + bits[j0 * stride + i0]!;
        const inside = sum === 0 ? 'dry' : sum === (j1 - j0) * (i1 - i0) ? 'wet' : 'mixed';
        const crossing = x < minX || z < minZ || x + span > minX + sizeX || z + span > minZ + sizeZ;
        return crossing && inside !== outside ? 'mixed' : inside;
    };
}

/** Inward-facing world-space clip planes of the resolved camera, including orthographic views. */
export function waterViewPlanes(matrix: Float32Array): number[][] {
    const planes: number[][] = [];
    for (let axis = 0; axis < 3; axis++)
        for (const sign of [-1, 1]) {
            planes.push([0, 4, 8, 12].map((i) => matrix[i + 3]! + sign * matrix[i + axis]!));
        }
    return planes;
}

export function selectWaterTiles(
    layout: TileLayout,
    originX: number,
    originZ: number,
    eye: Eye,
    low: number,
    high: number,
    coverage: (x: number, z: number, span: number) => Coverage,
    planes: readonly number[][] = [],
): WaterTile[] {
    const { tile, halfX, halfZ, lodScale, collapse } = layout;
    const width = halfX * 2,
        height = halfZ * 2;
    const selected: WaterTile[] = [];
    function visit(i: number, j: number, level: number): void {
        if (i >= width || j >= height) return;
        const side = 2 ** level,
            x = originX + i * tile,
            z = originZ + j * tile,
            span = side * tile;
        for (const [a, b, c, d] of planes) {
            if (a! * (a! < 0 ? x : x + span) + b! * (b! < 0 ? low : high) + c! * (c! < 0 ? z : z + span) + d! < 0) return;
        }
        const water = coverage(x, z, span);
        if (water === 'dry') return;
        const distance = Math.hypot(
            Math.max(x - eye[0], 0, eye[0] - x - span),
            Math.max(low - eye[1], 0, eye[1] - high),
            Math.max(z - eye[2], 0, eye[2] - z - span),
        );
        if (
            level > 0 &&
            (i + side > width ||
                j + side > height ||
                distance < span * lodScale ||
                (water === 'mixed' && (collapse < 0 || level < collapse)))
        ) {
            const half = side / 2;
            visit(i, j, level - 1);
            visit(i + half, j, level - 1);
            visit(i, j + half, level - 1);
            visit(i + half, j + half, level - 1);
        } else selected.push({ x: i, z: j, level });
    }
    visit(0, 0, Math.ceil(Math.log2(Math.max(width, height))));
    return selected;
}

/** Indexed, alternating triangle diagonals. On a mixed-density boundary the fine indices
 * use the coarser edge's actual vertices. Both faces share the same wave and morph data. */
export function buildWaterTiles(layout: TileLayout, tiles: readonly WaterTile[], wire: boolean, apron: boolean): MeshData {
    const n = layout.divisions,
        unit = layout.tile / n,
        width = 2 * layout.halfX * n,
        height = 2 * layout.halfZ * n;
    const positions: number[] = [],
        colours: number[] = [],
        indices: number[] = [];
    const shared = new Map<number, number>();
    const byLevel = Array.from({ length: 10 }, () => new Map<number, WaterTile>());
    for (const t of tiles) byLevel[t.level]!.set(t.z * 1024 + t.x, t);
    function neighbour(x: number, z: number): number {
        if (x < 0 || z < 0 || x >= 2 * layout.halfX || z >= 2 * layout.halfZ) return 0;
        for (let level = 0; level < byLevel.length; level++) {
            const step = 2 ** level;
            if (byLevel[level]!.has(Math.floor(z / step) * step * 1024 + Math.floor(x / step) * step)) return level;
        }
        return 0;
    }
    const face = (a: number, b: number, c: number) => {
        if (a !== b && b !== c && a !== c) indices.push(a, b, c);
    };
    for (const { x, z, level } of tiles) {
        const step = 2 ** level;
        const sides = [
            neighbour(x - 0.5, z + step / 2),
            neighbour(x + step + 0.5, z + step / 2),
            neighbour(x + step / 2, z - 0.5),
            neighbour(x + step / 2, z + step + 0.5),
        ];
        const local = new Int32Array((n + 1) * (n + 1));
        for (let j = 0; j <= n; j++)
            for (let i = 0; i <= n; i++) {
                let gx = x * n + i * step,
                    gz = z * n + j * step;
                let edge = level;
                if (i === 0 || i === n) {
                    edge = Math.max(edge, sides[i === 0 ? 0 : 1]!);
                    gz = Math.floor(gz / 2 ** edge) * 2 ** edge;
                }
                if (j === 0 || j === n) {
                    const along = Math.max(level, sides[j === 0 ? 2 : 3]!);
                    gx = Math.floor(gx / 2 ** along) * 2 ** along;
                    edge = Math.max(edge, along);
                }
                const key = gz * (width + 1) + gx,
                    boundary = i === 0 || j === 0 || i === n || j === n;
                let id = boundary ? shared.get(key) : undefined;
                if (id === undefined) {
                    id = positions.length / 3;
                    if (boundary) shared.set(key, id);
                    positions.push(gx * unit, 0, gz * unit);
                    const outer = gx === 0 || gz === 0 || gx === width || gz === height;
                    colours.push(edge / 15, apron && outer ? 0 : 1, 0, 1);
                } else colours[id * 4] = Math.max(colours[id * 4]!, edge / 15);
                local[j * (n + 1) + i] = id;
            }
        for (let j = 0; j < n; j++)
            for (let i = 0; i < n; i++) {
                const k = j * (n + 1) + i,
                    a = local[k]!,
                    b = local[k + n + 1]!,
                    c = local[k + 1]!,
                    d = local[k + n + 2]!;
                if ((i + j) % 2 === 0) {
                    face(a, b, d);
                    face(a, d, c);
                } else {
                    face(a, b, c);
                    face(c, b, d);
                }
            }
    }
    if (!wire) return packWaterMesh(positions, colours, indices);
    const p: number[] = [],
        c: number[] = [],
        elements: number[] = [];
    for (const id of indices) {
        const corner = elements.length % 3;
        p.push(positions[id * 3]!, positions[id * 3 + 1]!, positions[id * 3 + 2]!);
        c.push(colours[id * 4]!, colours[id * 4 + 1]!, corner === 0 ? 1 : 0, corner === 1 ? 1 : 0);
        elements.push(elements.length);
    }
    return packWaterMesh(p, c, elements);
}

/** Four strips extend the finite, rectangular water zone to the horizon. The inner rim
 * overlaps the tiled edge just under sea level so waves cannot open a slit to the sky. */
export function buildWaterApron(l: TileLayout, extent: number, drop: number, wire: boolean): MeshData | null {
    const x = l.tile * l.halfX,
        z = l.tile * l.halfZ;
    if (extent <= Math.max(x, z)) return null;
    const inner = [
            [-x, -z],
            [x, -z],
            [x, z],
            [-x, z],
        ],
        outer = [
            [-extent, -extent],
            [extent, -extent],
            [extent, extent],
            [-extent, extent],
        ];
    const p: number[] = [],
        c: number[] = [],
        i: number[] = [];
    for (let side = 0; side < 4; side++) {
        const next = (side + 1) % 4;
        for (const [ring, index] of [
            [inner, side],
            [inner, next],
            [outer, side],
            [inner, next],
            [outer, next],
            [outer, side],
        ] as const) {
            const q = ring[index]!,
                k = i.length;
            const overlap = ring === inner ? Math.min(l.tile * 0.02, x * 0.01, z * 0.01) : 0;
            p.push(x + q[0]! - Math.sign(q[0]!) * overlap, -drop, z + q[1]! - Math.sign(q[1]!) * overlap);
            c.push(1, 0, wire && k % 3 === 0 ? 1 : 0, wire ? Number(k % 3 === 1) : 1);
            i.push(k);
        }
    }
    return packWaterMesh(p, c, i);
}

/** Split only the indices of one conforming mesh. Each triangle belongs to exactly one
 * surface or junction material, and boundary vertices keep their identical morph data. */
export function waterMaterialMeshes(data: MeshData, at: (x: number, z: number) => number): Map<number, MeshData> {
    const batches = new Map<number, number[]>(),
        bytes = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
    const position = data.channels[0]!.offset;
    for (let i = 0; i < data.indices.length; i += 3) {
        let x = 0,
            z = 0;
        for (let v = 0; v < 3; v++) {
            const offset = data.indices[i + v]! * data.vertexStride + position;
            x += bytes.getFloat32(offset, true);
            z += bytes.getFloat32(offset + 8, true);
        }
        const id = at(x / 3, z / 3);
        let batch = batches.get(id);
        if (!batch) {
            batch = [];
            batches.set(id, batch);
        }
        batch.push(data.indices[i]!, data.indices[i + 1]!, data.indices[i + 2]!);
    }
    const meshes = new Map<number, MeshData>();
    for (const [id, indices] of batches) {
        if (batches.size === 1) {
            meshes.set(id, data);
            break;
        }
        const ids = new Map<number, number>();
        const remapped = Uint32Array.from(indices, (index) => {
            if (!ids.has(index)) ids.set(index, ids.size);
            return ids.get(index)!;
        });
        const vertices = new Uint8Array(ids.size * data.vertexStride);
        for (const [old, index] of ids)
            vertices.set(
                data.vertices.subarray(old * data.vertexStride, (old + 1) * data.vertexStride),
                index * data.vertexStride,
            );
        meshes.set(id, { ...data, vertices, vertexCount: ids.size, indices: remapped });
    }
    return meshes;
}
