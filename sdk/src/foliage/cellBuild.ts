// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cellBuild.ts
 * @brief   One cell of a Foliage, from where its plants may stand to the geometry of them: the part that is only computation.
 *
 * @details Growing a cell is two things. Working out where its plants stand and what they look like — a few thousand questions of the
 *          ground, then tens of thousands of vertices — is arithmetic on data, 4 to 12 ms of it a cell. Putting the result in the world
 *          (two meshes on the GPU and an entity) is the engine's, and quick.
 *
 *          The first is here, as one function of plain data, so it runs the same wherever it is called: on a worker, which is where it
 *          belongs, or on the main thread where a worker cannot be given the ground (a terrain with modifiers laid on it, a game's own
 *          provider). One implementation is also why the two cannot come to disagree about a cell.
 */
import type { MeshData } from '../asset/meshFormat';
import { buildBillboardMesh, buildGrassMesh, rankedPlants, buildInstancedMesh, scatterCell, type Ground } from './builder';

/** The ground a cell's plants stand on, as the terrain answers it. */
export interface CellGround {
    heightAt(x: number, z: number): number | null;
    normalAt(x: number, z: number): readonly [number, number, number] | null;
}

/** What a cell is grown against: the ground (or a flat height where there is none), the water, the zones that keep plants out. */
export interface CellSurroundings {
    ground: CellGround | null;
    /** The height of the ground where there is no terrain: the Foliage entity's own. */
    flatY: number;
    water: { depthAt(x: number, z: number, y: number): number | null } | null;
    zones: { excluding(x: number, z: number, radius: number, tags: readonly string[], seed: number): unknown } | null;
    density?: DensityMap | null;
}

/** A blade's or a plant's own colours, where no material paints it. */
export type CellPaint = { base: [number, number, number]; tip: [number, number, number] } | null;

/** One cell to grow: plain data, so it can be sent to a worker as it is. */
export interface FoliageCellSpec {
    /** The cell's centre and side in the world, and how many plants are tried in it. */
    centerX: number;
    centerZ: number;
    size: number;
    count: number;
    seed: number;
    cellKey: number;
    minScale: number;
    maxScale: number;
    minUp: number;
    heightMin: number;
    heightMax: number;
    /** The deepest water a plant may stand in. */
    waterDepth: number;
    /** How far from a zone's edge a plant is kept, and what it is kept out as. */
    zonePadding: number;
    tags: string[];
    /** The Foliage entity's height: the plants carry the ground's height relative to it. */
    baseY: number;
    /** The copies of a mesh carry, in a second uv, where each vertex of a head sits from its plant's axis: what a shader turns the head about. */
    seats?: boolean;
    paint: CellPaint;
    /**
     * The far versions: how many there are (1 to 3), the share of its plants each keeps of the one before, the most a kept plant is
     * grown by, and whether a mesh's far version is cards (a tree) or the plant itself, fewer and larger. With `only`, the cell is that one
     * version alone (0 the near one), marked with its band: each version is then a layer of cells of its own, grown only as far out as it is drawn.
     */
    far: { levels: number; keep: number; grow: number; cards: boolean; only?: number | null; up?: number; tilt?: number };
    /** Grass, as blades of this size; or copies of a mesh, with the card its far version is drawn as. */
    look: { kind: 'grass'; bladeHeight: number; bladeWidth: number }
        | { kind: 'mesh'; card: { u0: number; v0: number; u1: number; v1: number }; tent: boolean };
}

/** How densely plants stand over an area, read from an image's red: 0 none, 255 as many as the field asks. Nothing grows off it. */
export interface DensityMap {
    width: number;
    height: number;
    values: Uint8Array;
    /** The corner and the size of what the image covers, in the world. */
    originX: number;
    originZ: number;
    sizeX: number;
    sizeZ: number;
}

/** The share of plants that stand at (x, z), 0 to 1: the four texels about it blended. */
export function densityAt(map: DensityMap, x: number, z: number): number {
    const u = (x - map.originX) / map.sizeX, v = (z - map.originZ) / map.sizeZ;
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return 0;
    const fx = Math.min(u * map.width - 0.5, map.width - 1), fz = Math.min(v * map.height - 0.5, map.height - 1);
    const x0 = Math.max(Math.floor(fx), 0), z0 = Math.max(Math.floor(fz), 0);
    const x1 = Math.min(x0 + 1, map.width - 1), z1 = Math.min(z0 + 1, map.height - 1);
    const tx = Math.min(Math.max(fx - x0, 0), 1), tz = Math.min(Math.max(fz - z0, 0), 1);
    const at = (ix: number, iz: number): number => map.values[iz * map.width + ix]!;
    return ((at(x0, z0) * (1 - tx) + at(x1, z0) * tx) * (1 - tz) + (at(x0, z1) * (1 - tx) + at(x1, z1) * tx) * tz) / 255;
}

/** A number from 0 to 1 that is a place's own, whichever cell or thread asks: which plants a density thins out. */
function lot(x: number, z: number, seed: number): number {
    let h = Math.imul(Math.floor(x * 64) | 0, 374761393) ^ Math.imul(Math.floor(z * 64) | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Where a plant may stand in a cell, as `scatterCell` asks it. */
export function cellGround(spec: FoliageCellSpec, around: CellSurroundings): Ground {
    return (x, z) => {
        if (around.zones?.excluding(x, z, Math.max(0, spec.zonePadding), spec.tags, spec.seed)) return null;
        if (around.density && lot(x, z, spec.seed) >= densityAt(around.density, x, z)) return null;
        // With a terrain, a plant stands where there is ground and nowhere else; with none, the area is flat at the entity's height.
        const y = around.ground ? around.ground.heightAt(x, z) : around.flatY;
        if (y === null) return null;
        // Nor under water deeper than it may stand in.
        const depth = around.water?.depthAt(x, z, y);
        if (depth != null && depth > spec.waterDepth) return null;
        if (!around.ground) return { y, up: 1 };
        const n = around.ground.normalAt(x, z);
        return { y, up: n ? n[1] : 1 };
    };
}

/**
 * The geometry of a cell: its near mesh and its far one, or none where nothing grows in it. `source` is the plant's own mesh for a
 * cell of copies, and not read for grass.
 */
export function buildFoliageCell(spec: FoliageCellSpec, around: CellSurroundings, source: MeshData | null): MeshData[] {
    const plants = scatterCell({
        centerX: spec.centerX, centerZ: spec.centerZ, size: spec.size, count: spec.count, seed: spec.seed, cellKey: spec.cellKey,
        minScale: spec.minScale, maxScale: spec.maxScale, minUp: spec.minUp, heightMin: spec.heightMin, heightMax: spec.heightMax,
    }, cellGround(spec, around));
    if (plants.length === 0) return [];
    // The cell stands at its centre, on the entity's own base height; the plants carry the ground's height relative to that.
    for (const p of plants) p.y -= spec.baseY;
    const levels = Math.min(Math.max(Math.floor(spec.far.levels), 1), 3);
    const share = (level: number): number => Math.pow(Math.min(Math.max(spec.far.keep, 0.01), 1), level);
    // Where each version is a layer of its own the shader widens every blade as its neighbours thin, at any distance; here a far blade is made wider once.
    const wider = (level: number): number => (spec.far.only != null ? 1 : Math.min(Math.sqrt(1 / share(level)), Math.max(spec.far.grow, 1)));
    const only = spec.far.only ?? null;
    const band = only === null ? undefined : only;
    const copies = (level: number): MeshData | null => {
        const kept = level === 0 ? plants : rankedPlants(plants, share(level), spec.far.grow, undefined, spec.far.up ?? 0, spec.far.tilt ?? 0);
        return kept.length === 0 ? null : buildInstancedMesh(source!, kept, spec.paint, band, !!spec.seats);
    };
    // A far blade is one quad, a little taller and as much wider as covers the ground of the ones left out: grass grows broader, not higher.
    const blades = (level: number): MeshData | null => {
        if (spec.look.kind !== 'grass') return null;
        const blade = { height: spec.look.bladeHeight, width: spec.look.bladeWidth, paint: spec.paint, band };
        if (level === 0) return buildGrassMesh(plants, { ...blade, segments: 3, thin: 1 });
        const kept = rankedPlants(plants, share(level), 1);
        return kept.length === 0 ? null : buildGrassMesh(kept, { ...blade, height: blade.height * 1.1, width: blade.width * wider(level), segments: 1, thin: 1 });
    };
    if (spec.look.kind === 'mesh' && !source) throw new Error('a cell of copies needs the mesh it copies');
    const version = spec.look.kind === 'mesh' ? copies : blades;
    if (only !== null) {
        const mesh = version(Math.min(Math.max(Math.floor(only), 0), levels));
        return mesh ? [mesh] : [];
    }
    if (spec.look.kind === 'mesh' && spec.far.cards) {
        const width = Math.max(source!.aabbMax[0] - source!.aabbMin[0], source!.aabbMax[2] - source!.aabbMin[2]);
        return [copies(0)!, buildBillboardMesh(plants, width, source!.aabbMax[1] - source!.aabbMin[1], spec.look.card, spec.paint, spec.look.tent)];
    }
    // A far version with no plant left is the end of them: past the last, the cell draws nothing.
    const out: MeshData[] = [];
    for (let level = 0; level <= levels; level++) {
        const mesh = version(level);
        if (!mesh) break;
        out.push(mesh);
    }
    return out;
}

/** The buffers of a cell's meshes, to hand them between threads without a copy. */
export function cellTransfers(meshes: readonly MeshData[]): ArrayBuffer[] {
    const out: ArrayBuffer[] = [];
    for (const m of meshes) out.push(m.vertices.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer);
    return out;
}
