// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    navStreaming.ts
 * @brief   A streamed world's navigation: a tile per grid square that is there, rebaked as cells come and go.
 *
 * @details A square of the world's grid inside the NavVolume has a tile when its cell is resident, or when it has no cell at all
 *          (ground the persistent world alone holds). A tile is baked from every collider in and just around its square, so it
 *          is rebaked when any cell whose box reaches that far arrives or leaves; a square whose cell leaves loses its tile. The
 *          tiles are stitched into the one mesh agents walk once none is waiting to be baked, a few baked a frame so a cell's
 *          arrival is not one long frame.
 */

import type { World } from '../../ecs/world';
import type { Entity, Vec3 } from '../../types';
import { Transform } from '../../ecs/component';
import { NavVolume, type NavVolumeData } from './NavVolume';
import type { Navigation } from './Navigation';
import { bakeNavTile, stitchNavTiles, type NavSquare, type NavTile } from './navTiles';
import type { NavObstacleBox, NavAreaBox } from './navmesh/compact';
import type { WorldCell, WorldManifest } from '../../residency/cells';
import type { WorldResidencyView } from '../../residency/WorldStreamer';

/** Tiles baked in one frame at most: a cell arriving costs a few frames a tile, not one frame all of them. */
const TILES_PER_FRAME = 2;

/** The tiles of a streamed world's NavVolume, and what is waiting to be baked. @experimental */
export class StreamedNavigation {
    private readonly tiles_ = new Map<string, NavTile>();
    private readonly dirty_ = new Set<string>();
    private resident_ = new Set<string>();
    private epoch_ = -1;
    private volume_: Entity | null = null;
    private manifest_: WorldManifest | null = null;
    private changed_ = false;

    /** Tiles present now, by square. */
    get tileCount(): number { return this.tiles_.size; }
    /** Squares waiting to be baked. */
    get pending(): number { return this.dirty_.size; }

    /** Every present tile baked again, for what changes the whole world: an obstacle moved, a cost patch changed. */
    dirtyAll(): void {
        for (const key of this.tiles_.keys()) this.dirty_.add(key);
    }

    /**
     * Bring the tiles to what is resident and install the stitched mesh when they are. `geometry` is null until the world's
     * colliders can answer, in which case nothing is baked yet.
     */
    update(
        world: World, nav: Navigation, residency: WorldResidencyView,
        geometry: ((min: Vec3, max: Vec3, layers: number) => { verts: Float32Array; indices: ArrayLike<number> }) | null,
        obstacles: readonly NavObstacleBox[], areas: readonly NavAreaBox[],
    ): void {
        const manifest = residency.manifest;
        const volumes = world.getEntitiesWithComponents([NavVolume, Transform]);
        if (!manifest || volumes.length === 0) return;
        const volume = volumes[0]!;
        if (volume !== this.volume_ || manifest !== this.manifest_) {
            // Another volume or another world: everything starts again.
            this.volume_ = volume;
            this.manifest_ = manifest;
            this.tiles_.clear();
            this.dirty_.clear();
            this.resident_ = new Set();
            this.epoch_ = -1;
            this.changed_ = true;
        }
        const data = world.get(volume, NavVolume) as NavVolumeData;
        const at = (world.get(volume, Transform) as { position: Vec3 }).position;
        const h = data.halfExtents;

        if (residency.residencyEpoch !== this.epoch_) {
            this.epoch_ = residency.residencyEpoch;
            const resident = new Set(manifest.cells.filter((c) => residency.residencyOf(c.name) === 'resident').map((c) => c.name));
            const moved: WorldCell[] = manifest.cells.filter((c) => resident.has(c.name) !== this.resident_.has(c.name));
            this.resident_ = resident;
            const wanted = this.wantedSquares(manifest, at, h, resident);
            for (const key of [...this.tiles_.keys()]) {
                if (!wanted.has(key)) { this.tiles_.delete(key); this.dirty_.delete(key); this.changed_ = true; }
            }
            for (const [key, square] of wanted) {
                if (!this.tiles_.has(key)) { this.dirty_.add(key); continue; }
                // A tile reads the colliders in and around its square: any cell reaching there that came or went changes it.
                const pad = data.agentRadius + data.cellSize * 4;
                if (moved.some((c) => c.minX < square.maxX + pad && c.maxX > square.minX - pad
                    && c.minZ < square.maxZ + pad && c.maxZ > square.minZ - pad)) this.dirty_.add(key);
            }
        }
        if (!geometry) return;

        const wanted = this.wantedSquares(manifest, at, h, this.resident_);
        let baked = 0;
        for (const key of [...this.dirty_]) {
            if (baked >= TILES_PER_FRAME) break;
            this.dirty_.delete(key);
            const square = wanted.get(key);
            if (!square) continue;
            this.tiles_.set(key, bakeNavTile(square, at.y - h.y, at.y + h.y,
                (min, max) => geometry(min, max, data.layers), {
                    cellSize: data.cellSize, cellHeight: data.cellHeight, maxSlopeDegrees: data.maxSlopeDegrees,
                    agentHeight: data.agentHeight, agentRadius: data.agentRadius, stepHeight: data.stepHeight,
                    obstacles, areas,
                }));
            baked++;
            this.changed_ = true;
        }
        if (this.changed_ && this.dirty_.size === 0) {
            this.changed_ = false;
            nav.setSurface(stitchNavTiles([...this.tiles_.values()], data.stepHeight));
            nav.invalidatePaths();
        }
    }

    /** The squares inside the volume that should have a tile: a resident cell's, or one no cell covers. */
    private wantedSquares(manifest: WorldManifest, at: Vec3, h: Vec3, resident: ReadonlySet<string>): Map<string, NavSquare> {
        const size = manifest.cellSize;
        const cells = new Map<string, WorldCell>();
        for (const cell of manifest.cells) cells.set(`${cell.x},${cell.z}`, cell);
        const out = new Map<string, NavSquare>();
        const x0 = Math.floor((at.x - h.x) / size), x1 = Math.floor((at.x + h.x - 1e-6) / size);
        const z0 = Math.floor((at.z - h.z) / size), z1 = Math.floor((at.z + h.z - 1e-6) / size);
        for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
                const key = `${x},${z}`;
                const cell = cells.get(key);
                if (cell && !resident.has(cell.name)) continue;
                out.set(key, { minX: x * size, minZ: z * size, maxX: (x + 1) * size, maxZ: (z + 1) * size });
            }
        }
        return out;
    }
}
