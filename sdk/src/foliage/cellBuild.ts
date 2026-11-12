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
import { buildBillboardMesh, buildGrassMesh, buildInstancedMesh, scatterCell, type Ground } from './builder';

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
    paint: CellPaint;
    /** Grass, as blades of this size; or copies of a mesh, with the card its far version is drawn as. */
    look: { kind: 'grass'; bladeHeight: number; bladeWidth: number }
        | { kind: 'mesh'; card: { u0: number; v0: number; u1: number; v1: number }; tent: boolean };
}

/** Where a plant may stand in a cell, as `scatterCell` asks it. */
export function cellGround(spec: FoliageCellSpec, around: CellSurroundings): Ground {
    return (x, z) => {
        if (around.zones?.excluding(x, z, Math.max(0, spec.zonePadding), spec.tags, spec.seed)) return null;
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
    if (spec.look.kind === 'mesh') {
        if (!source) throw new Error('a cell of copies needs the mesh it copies');
        const width = Math.max(source.aabbMax[0] - source.aabbMin[0], source.aabbMax[2] - source.aabbMin[2]);
        return [
            buildInstancedMesh(source, plants, spec.paint),
            buildBillboardMesh(plants, width, source.aabbMax[1] - source.aabbMin[1], spec.look.card, spec.paint, spec.look.tent),
        ];
    }
    const blade = { height: spec.look.bladeHeight, width: spec.look.bladeWidth, paint: spec.paint };
    return [buildGrassMesh(plants, { ...blade, segments: 3, thin: 1 }), buildGrassMesh(plants, { ...blade, segments: 1, thin: 3 })];
}

/** The buffers of a cell's meshes, to hand them between threads without a copy. */
export function cellTransfers(meshes: readonly MeshData[]): ArrayBuffer[] {
    const out: ArrayBuffer[] = [];
    for (const m of meshes) out.push(m.vertices.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer);
    return out;
}
