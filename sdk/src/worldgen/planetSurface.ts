// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planetSurface.ts
 * @brief   A planet's ground as a plane for laying a world out on: each face of the cube is one, in metres.
 *
 * @details The plan (plan.ts) works on a plane of x and z. A round world has none, but each face of the cube the planet is cut into (terrain/sphere.ts)
 *          is a square of ground that reads as one: x and z are metres across the face from its middle (a quarter turn of the great circle
 *          is a face's width, so a metre on the plane is a metre on the ground at the middle and a third less at the corner), and the
 *          height is the ground's height above the radius. A world is laid out face by face, and a direction is laid out by the face it falls on, so
 *          a point is planned once. What is placed is taken from the plane to the planet here: its place, and which way is up.
 */
import type { PlanetFacts } from '../terrain/planetQuery';
import { FACES, direction, facePlace } from '../terrain/sphere';
import { tangentFrame } from '../terrain/planetPages';
import type { EnvironmentInputs } from './fields';
import { Zones, type ZoneDef } from './zones';

/** The metres a unit of a face's -1 to 1 is, at its middle. */
export const faceUnit = (radius: number): number => radius * Math.PI / 4;

/** How wide a face is, in metres across the plane (-half to +half). */
export const faceHalf = (radius: number): number => faceUnit(radius);

/** Where a point of the plane stands on the planet: its direction from the centre, the unit vectors along the plane's x, up and z there. */
export interface PlaneFrame {
    dir: [number, number, number];
    eu: [number, number, number];
    ev: [number, number, number];
}

/** Metres between the points of a tile, the cells along its side, and so its side; how many tiles a face keeps. */
/** How far apart the ground is read for a world laid out on a planet, unless the world says (`WorldGen.groundStep`): metres, for a world a person walks. */
export const GROUND_STEP = 1.5;
const TILE_CELLS = 32;
const TILES_KEPT = 6000;

/** A square of the planet's answer: its heights, its paint and its fields at a grid of points (one extra row and column each side). */
interface Tile {
    x0: number;
    z0: number;
    n: number;
    heights: Float32Array;
    paint: Float32Array | undefined;
    fields: Float32Array | undefined;
    fieldCount: number;
}

/** One face of a planet as a plane. */
export class PlanetFace {
    /**
     * @param step How far apart the ground is read, in the planet's units. What is placed stands on the ground between the points read, and a slope is
     *             taken over two of them: a world whose plants are tens of units across and seen from the air reads it several units apart, and pays a
     *             sixteenth of what reading it every metre and a half costs for each doubling twice over.
     */
    constructor(readonly face: number, readonly planet: () => PlanetFacts | null, readonly step = GROUND_STEP) {}

    private get side(): number { return this.step * TILE_CELLS; }

    private facts(): PlanetFacts | null { return this.planet(); }

    /** The unit direction from the centre at a point of the plane (beyond the face's edge it carries on over the next). */
    directionAt(x: number, z: number): [number, number, number] {
        const f = this.facts();
        const unit = faceUnit(f?.radius ?? 1);
        return direction(this.face, x / unit, z / unit);
    }

    /** The point of the plane under a direction from the centre, or null for a direction that does not face this one. */
    planeOf(dx: number, dy: number, dz: number): { x: number; z: number } | null {
        const f = this.facts();
        const at = facePlace(this.face, dx, dy, dz);
        if (!f || !at) return null;
        const unit = faceUnit(f.radius);
        return { x: at.u * unit, z: at.v * unit };
    }

    /** The frame at a point of the plane. */
    frameAt(x: number, z: number): PlaneFrame {
        const dir = this.directionAt(x, z);
        const eu: [number, number, number] = [0, 0, 0], ev: [number, number, number] = [0, 0, 0];
        tangentFrame(this.face, dir, eu, ev);
        return { dir, eu, ev };
    }

    /** The world position of a point of the plane at a height above the radius. */
    world(x: number, y: number, z: number): [number, number, number] {
        const f = this.facts()!;
        const d = this.directionAt(x, z), r = f.radius + y;
        return [f.centre[0] + d[0] * r, f.centre[1] + d[1] * r, f.centre[2] + d[2] * r];
    }

    /** The tiles of the planet's answer this face has read, newest last: a world is laid out from these, not from a call of the provider for each point it asks about. */
    private readonly tiles_ = new Map<string, Tile>();

    /** The tile of the plane that holds (x, z), read from the provider in one call for all its points; null while the provider answers later. */
    private tile(x: number, z: number): Tile | null {
        const TILE_SIDE = this.side, TILE_STEP = this.step;
        const tx = Math.floor(x / TILE_SIDE), tz = Math.floor(z / TILE_SIDE), key = `${tx},${tz}`;
        const had = this.tiles_.get(key);
        if (had) { this.tiles_.delete(key); this.tiles_.set(key, had); return had; }
        const f = this.facts();
        if (!f?.sampleMany) return null;
        // One more point than cells each way, and a point past each edge, so the neighbours' tiles agree at the join and a slope can be taken at the edge.
        const n = TILE_CELLS + 3;
        const dirs = new Float32Array(n * n * 3);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            const d = this.directionAt(tx * TILE_SIDE + (i - 1) * TILE_STEP, tz * TILE_SIDE + (j - 1) * TILE_STEP);
            dirs[(j * n + i) * 3] = d[0]; dirs[(j * n + i) * 3 + 1] = d[1]; dirs[(j * n + i) * 3 + 2] = d[2];
        }
        const got = f.sampleMany(dirs, n * n);
        if (!got) return null;
        const tile: Tile = { x0: tx * TILE_SIDE - TILE_STEP, z0: tz * TILE_SIDE - TILE_STEP, n, heights: got.heights, paint: got.paint, fields: got.fields, fieldCount: f.fieldNames.length };
        this.tiles_.set(key, tile);
        if (this.tiles_.size > TILES_KEPT) this.tiles_.delete(this.tiles_.keys().next().value!);
        return tile;
    }

    /** The cell of a tile that holds (x, z), and where in it. */
    private cellOf(t: Tile, x: number, z: number): { i: number; j: number; fx: number; fz: number } {
        const u = (x - t.x0) / this.step, v = (z - t.z0) / this.step;
        const i = Math.min(Math.max(Math.floor(u), 0), t.n - 2), j = Math.min(Math.max(Math.floor(v), 0), t.n - 2);
        return { i, j, fx: Math.min(Math.max(u - i, 0), 1), fz: Math.min(Math.max(v - j, 0), 1) };
    }

    /** The ground's height above the radius at (x, z), filtered between the tile's points; null where it cannot be said yet. */
    private heightAt(x: number, z: number): number | null {
        const t = this.tile(x, z);
        if (!t) return null;
        const { i, j, fx, fz } = this.cellOf(t, x, z), n = t.n, h = t.heights;
        const a = h[j * n + i]!, b = h[j * n + i + 1]!, c = h[(j + 1) * n + i]!, d = h[(j + 1) * n + i + 1]!;
        return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
    }

    /** The planet's layers' paint at (x, z) from the provider (the nearest point of its tile), or null where it does not paint or cannot say yet. */
    paintAt(x: number, z: number): readonly number[] | null {
        const t = this.tile(x, z);
        if (!t?.paint) return null;
        const { i, j, fx, fz } = this.cellOf(t, x, z), k = (j + (fz > 0.5 ? 1 : 0)) * t.n + i + (fx > 0.5 ? 1 : 0);
        return [t.paint[k * 4]!, t.paint[k * 4 + 1]!, t.paint[k * 4 + 2]!, t.paint[k * 4 + 3]!];
    }

    /** The provider's own fields at (x, z), filtered between the tile's points; null where it has none or cannot say yet. */
    fieldsAt(x: number, z: number): readonly number[] | null {
        const t = this.tile(x, z);
        if (!t?.fields || t.fieldCount === 0) return null;
        const { i, j, fx, fz } = this.cellOf(t, x, z), m = t.fieldCount, n = t.n;
        const out: number[] = [];
        for (let c = 0; c < m; c++) {
            const a = t.fields[(j * n + i) * m + c]!, b = t.fields[(j * n + i + 1) * m + c]!, e = t.fields[((j + 1) * n + i) * m + c]!, d = t.fields[((j + 1) * n + i + 1) * m + c]!;
            out.push((a + (b - a) * fx) * (1 - fz) + (e + (d - e) * fx) * fz);
        }
        return out;
    }

    /** The ground under a point of the plane: its height above the radius, how much it faces away from the centre, and its normal along the plane's x, up and z. */
    ground(x: number, z: number): { y: number; up: number; normal: [number, number, number] } | null {
        const h = this.heightAt(x, z);
        if (h === null) return null;
        // The normal from the ground a step either way along the plane: the rise over the run (the curve of the planet itself is not a slope).
        const step = this.step;
        const hx0 = this.heightAt(x - step, z), hx1 = this.heightAt(x + step, z), hz0 = this.heightAt(x, z - step), hz1 = this.heightAt(x, z + step);
        if (hx0 === null || hx1 === null || hz0 === null || hz1 === null) return { y: h, up: 1, normal: [0, 1, 0] };
        const run = 2 * step;
        const nx = -(hx1 - hx0) / run, nz = -(hz1 - hz0) / run;
        const len = Math.hypot(nx, 1, nz);
        return { y: h, up: 1 / len, normal: [nx / len, 1 / len, nz / len] };
    }

    /** What a plane normal is in the world: along the frame's x, up and z. */
    worldNormal(normal: readonly [number, number, number], x: number, z: number): [number, number, number] {
        const fr = this.frameAt(x, z);
        return [
            normal[0] * fr.eu[0] + normal[1] * fr.dir[0] + normal[2] * fr.ev[0],
            normal[0] * fr.eu[1] + normal[1] * fr.dir[1] + normal[2] * fr.ev[1],
            normal[0] * fr.eu[2] + normal[1] * fr.dir[2] + normal[2] * fr.ev[2],
        ];
    }

    /** The environment's inputs for this face: the ground, and the noise read in three dimensions from the point's place on the sphere. */
    environment(): Pick<EnvironmentInputs, 'ground' | 'space'> {
        return {
            ground: (x, z) => this.ground(x, z),
            space: (x, z) => {
                const f = this.facts()!;
                const d = this.directionAt(x, z);
                return [d[0] * f.radius, d[1] * f.radius, d[2] * f.radius];
            },
        };
    }

    /** A zone of the world (a circle or a box standing at a world position) as this face's plane has it, or null where its centre is not over this face. */
    zoneOnFace(zone: ZoneDef): ZoneDef | null {
        const f = this.facts();
        const s = zone.shape;
        if (!f || s.y === undefined) return null;
        const dx = s.x - f.centre[0], dy = s.y - f.centre[1], dz = s.z - f.centre[2];
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-9) return null;
        const at = this.planeOf(dx / len, dy / len, dz / len);
        const half = faceHalf(f.radius);
        // A zone is kept on the face its centre falls on, and on a neighbour when it reaches over the edge.
        const reach = (s.type === 'circle' ? s.radius : Math.hypot(s.halfX, s.halfZ)) + zone.falloff;
        if (!at || Math.abs(at.x) > half + reach || Math.abs(at.z) > half + reach) return null;
        if (s.type === 'circle') return { ...zone, shape: { type: 'circle', x: at.x, z: at.z, radius: s.radius } };
        // A box's own turn: where its x axis points, as an angle from the plane's x toward its z there (the world's own turn when it names no facing).
        const fr = this.frameAt(at.x, at.z);
        const ax = s.facing ?? [Math.cos(s.yaw ?? 0), 0, Math.sin(s.yaw ?? 0)];
        const yaw = Math.atan2(ax[0] * fr.ev[0] + ax[1] * fr.ev[1] + ax[2] * fr.ev[2], ax[0] * fr.eu[0] + ax[1] * fr.eu[1] + ax[2] * fr.eu[2]);
        return { ...zone, shape: { type: 'rect', x: at.x, z: at.z, halfX: s.halfX, halfZ: s.halfZ, yaw } };
    }

    /** The streaming sources, in this face's plane (those over it, and over its neighbours' edges within `reach`). */
    sourcesOnFace(sources: Iterable<{ x: number; y?: number; z: number }>, reach: number): { x: number; z: number }[] {
        const f = this.facts();
        const out: { x: number; z: number }[] = [];
        if (!f) return out;
        const half = faceHalf(f.radius);
        for (const s of sources) {
            const dx = s.x - f.centre[0], dy = (s.y ?? 0) - f.centre[1], dz = s.z - f.centre[2];
            const len = Math.hypot(dx, dy, dz);
            if (len < 1e-9) continue;
            const at = this.planeOf(dx / len, dy / len, dz / len);
            if (at && Math.abs(at.x) <= half + reach && Math.abs(at.z) <= half + reach) out.push(at);
        }
        return out;
    }
}

/** The six faces of a planet, as planes. */
export function planetFaces(planet: () => PlanetFacts | null, step = GROUND_STEP): PlanetFace[] {
    return FACES.map((_f, i) => new PlanetFace(i, planet, step));
}

/** The zones of a world as each face has them: those over it, in its plane. Kept in step by `sync`. */
export class FaceZones {
    readonly zones = new Zones();
    constructor(readonly face: PlanetFace) {}

    /** Takes the world's zones, replacing what was there: only what changed touches the plan. */
    sync(world: Iterable<ZoneDef>): void {
        const keep = new Set<string>();
        for (const z of world) {
            const mine = this.face.zoneOnFace(z);
            if (!mine) continue;
            this.zones.set(mine);
            keep.add(mine.id);
        }
        for (const z of [...this.zones.all()]) if (!keep.has(z.id)) this.zones.delete(z.id);
    }
}
