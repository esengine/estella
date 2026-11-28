// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planetCollision.ts
 * @brief   The planet's ground as collision geometry: the finest nodes round everything that moves, each cut into a grid of triangles.
 *
 * @details Each of the cube's six faces is a layer of procedural chunks (residency/chunks.ts) whose chunks are the finest nodes: a chunk is one node's
 *          square of the face, its place the node's ix and iz, so a layer's "world" is the face in node units and every mover is put there by
 *          where its direction from the centre falls on the face. A mover near an edge falls on both faces and is wanted by both. Every tile samples
 *          the same provider at the same directions the drawn ground does, so the ground stood on is the ground seen; two tiles that share an edge
 *          share its samples. A planet's transform carries a position only: a turned or scaled planet's collision stands where it would be unturned.
 */
import type { App } from '../app/app';
import { Transform, type TransformData } from '../ecs/component';
import type { Entity } from '../types';
import { chunksOf } from '../residency/chunks';
import { collisionGeometryOf } from '../runtime/collisionGeometry';
import { movers } from './movers';
import { direction, facePlace, nodeRect, type SphereNode } from './sphere';
import type { PlanetPageSource } from './planetPages';
import { copyCollisionPatchIndices, TERRAIN_PATCH_CELLS as TILE_CELLS } from './patchTopology';

/** How a planet's ground collides: whether it does, how far round a mover its tiles are built, its layer and friction, and its cells. */
export interface PlanetCollisionOptions {
    collision: boolean;
    collisionDistance: number;
    collisionLayer: number;
    friction: number;
}

const layerOf = (entity: Entity, face: number): string => `planet-collision:${entity}:${face}`;
const keyOf = (entity: Entity, n: SphereNode): string => `planet:${entity}:${n.face}:${n.ix}:${n.iz}`;

interface Tile { key: string; origin: [number, number, number]; positions: Float32Array; indices: Uint32Array }

/** One node's ground as triangles: positions measured from the node's middle (in the planet's space), wound to face out. @internal */
export function tileOf(src: PlanetPageSource, node: SphereNode, key: string): Tile | Promise<Tile> {
    const n = TILE_CELLS + 1;
    const { u0, v0, span } = nodeRect(src.levels, node);
    const dirs = new Float32Array(n * n * 3);
    const d: [number, number, number] = [0, 0, 0];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        direction(node.face, u0 + (i / TILE_CELLS) * span, v0 + (j / TILE_CELLS) * span, d);
        const k = (j * n + i) * 3;
        dirs[k] = d[0]; dirs[k + 1] = d[1]; dirs[k + 2] = d[2];
    }
    const build = (h: Float32Array): Tile => {
        const mid = direction(node.face, u0 + span / 2, v0 + span / 2);
        const origin: [number, number, number] = [mid[0] * src.radius, mid[1] * src.radius, mid[2] * src.radius];
        const positions = new Float32Array(n * n * 3);
        for (let q = 0; q < n * n; q++) {
            const r = src.radius + h[q]!;
            for (let c = 0; c < 3; c++) positions[q * 3 + c] = dirs[q * 3 + c]! * r - origin[c]!;
        }
        // Which way a cell's first triangle faces depends on the face's handedness: measured once, then every triangle is wound the same way.
        const p = (q: number, c: number): number => positions[q * 3 + c]!;
        const ex = [p(1, 0) - p(0, 0), p(1, 1) - p(0, 1), p(1, 2) - p(0, 2)], ez = [p(n, 0) - p(0, 0), p(n, 1) - p(0, 1), p(n, 2) - p(0, 2)];
        const cross = [ex[1]! * ez[2]! - ex[2]! * ez[1]!, ex[2]! * ez[0]! - ex[0]! * ez[2]!, ex[0]! * ez[1]! - ex[1]! * ez[0]!];
        const outward = cross[0]! * mid[0] + cross[1]! * mid[1] + cross[2]! * mid[2] > 0;
        return { key, origin, positions, indices: copyCollisionPatchIndices(outward) };
    };
    const got = src.provider.sample({ world: src.world, seed: src.seed, version: src.version, radius: src.radius, directions: dirs, count: n * n });
    return got instanceof Promise ? got.then((r) => build(r.heights)) : build(got.heights);
}

/**
 * Keeps the planet's collision layers: set every frame for the faces a mover is over, taken away when collision is off. Returns nothing; the geometry
 * is the physics world's to read (runtime/collisionGeometry.ts).
 */
export function updatePlanetCollision(app: App, entity: Entity, src: PlanetPageSource, epoch: number, options: PlanetCollisionOptions): void {
    const chunks = chunksOf(app);
    if (!options.collision) { removePlanetCollision(app, entity); return; }
    const centre = (app.world.get(entity, Transform) as TransformData).worldPosition;
    const geometry = collisionGeometryOf(app);
    const nodes = 2 ** (src.levels - 1);
    const leaf = (src.radius * Math.PI / 2) / nodes;
    const load = Math.max(options.collisionDistance, 0) / leaf;
    for (let face = 0; face < 6; face++) {
        chunks.set<Tile>(layerOf(entity, face), {
            label: 'Building the planet\'s collision',
            originX: 0, originZ: 0, sizeX: 1, sizeZ: 1,
            extent: [0, 0, nodes, nodes],
            loadRadius: load,
            unloadRadius: load + 1,
            generation: `${epoch}:${centre.x}:${centre.y}:${centre.z}:${options.collisionLayer}:${options.friction}`,
            sources: () => {
                const out: { x: number; z: number }[] = [];
                for (const m of movers(app)) {
                    const dx = m.x - centre.x, dy = (m.y ?? 0) - centre.y, dz = m.z - centre.z;
                    const len = Math.hypot(dx, dy, dz) || 1;
                    const at = facePlace(face, dx / len, dy / len, dz / len);
                    if (at) out.push({ x: (at.u + 1) / 2 * nodes, z: (at.v + 1) / 2 * nodes });
                }
                return out;
            },
            make: (ix, iz) => tileOf(src, { face, level: 0, ix, iz }, keyOf(entity, { face, level: 0, ix, iz })),
            publish: (_ix, _iz, tile) => {
                geometry.set(tile.key, {
                    owner: entity, origin: [centre.x + tile.origin[0], centre.y + tile.origin[1], centre.z + tile.origin[2]],
                    positions: tile.positions, indices: tile.indices, friction: options.friction, restitution: 0, layer: options.collisionLayer,
                });
            },
            release: (_ix, _iz, tile) => geometry.delete(tile.key),
        });
    }
}

/** Takes the planet's collision away. */
export function removePlanetCollision(app: App, entity: Entity): void {
    const chunks = chunksOf(app);
    for (let face = 0; face < 6; face++) chunks.remove(layerOf(entity, face));
}
