// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavMesh.ts
 * @brief   A polygon navigation mesh and the routes over it.
 *
 * The representation for a world made of geometry rather than cells: ground that
 * slopes, stacks and overhangs. Its polygons are convex, so a straight line
 * between two points of one is always walkable, and a route is therefore the
 * DOORWAYS it goes through rather than a chain of little steps — which is why a
 * path over a mesh comes out as a handful of turns instead of a staircase.
 *
 * Built by {@link buildNavMesh}; queried through {@link NavSurface} like any
 * other navigable world.
 */

import type { Vec3 } from '../../types';
import type { NavPoint, NavQueryOptions, NavSurface, NavSurfaceSink } from './NavSurface';
import { MinHeap } from './minHeap';
import { log } from '../../util/logger';

/** A way between two places the ground does not join, in world space. */
export interface NavLinkSegment {
    start: Vec3;
    end: Vec3;
    /** Whether it can be taken from `end` back to `start`. */
    bidirectional: boolean;
    /** How far from each end ground may be and still be joined. */
    radius: number;
}

/** One resolved link: the polygons it joins, and the two points it joins them at. */
interface NavLinkEdge {
    from: number;
    to: number;
    start: Vec3;
    end: Vec3;
}

export interface NavMeshData {
    /** `vertCount * 3` world-space floats. */
    verts: Float32Array;
    /** `maxVertsPerPoly` vertex indices per polygon, padded with -1. */
    polys: Int32Array;
    /** `maxVertsPerPoly` neighbour polygon indices, one per edge, -1 for none. */
    neis: Int32Array;
    polyCount: number;
    maxVertsPerPoly: number;
    /**
     * How far the mesh was pulled back from every wall when it was baked. An
     * agent no wider than this fits along any route over it; the mesh IS the set
     * of places such an agent's centre may stand.
     */
    agentRadius: number;
    /**
     * How far off the mesh a world point may be and still be taken as standing
     * on it, in world pixels — the bake's own resolution, since a point is only
     * ever off by the grid it was voxelised on plus the erosion.
     */
    snapDistance: number;
    /** What crossing each polygon costs, as an area id the cost table is read by. */
    areas: Uint8Array;
    /**
     * How far above or below a point a floor may be and still be the one it
     * stands on. Over more than one floor the nearest wins; this is what makes a
     * point with no floor anywhere near it answer "nowhere" rather than name the
     * roof three storeys up.
     */
    verticalReach: number;
}

/** How much the heuristic is trusted, as Detour weights it: a straight-line
 *  distance under-estimates a route through doorways, and scaling it up trades a
 *  little optimality for a much smaller search. */
const HEURISTIC_SCALE = 0.999;

export class NavMesh implements NavSurface {
    /** The mesh follows the ground, so off it is straight up. */
    readonly up: Vec3 = { x: 0, y: 1, z: 0 };

    readonly verts: Float32Array;
    readonly polys: Int32Array;
    readonly neis: Int32Array;
    readonly polyCount: number;
    readonly maxVertsPerPoly: number;
    readonly agentRadius: number;
    readonly snapDistance: number;
    readonly verticalReach: number;
    readonly areas: Uint8Array;
    /** What a unit of distance costs in each area, 1 for open ground. Read every
     *  search rather than baked in, so a swamp can dry out without a rebuild. */
    private areaCost_ = new Float32Array(256).fill(1);
    /** Ways between polygons that share no edge, both directions listed separately. */
    private links_: NavLinkEdge[] = [];
    private linksFrom_: Map<number, number[]> = new Map();

    /** Polygon bounds in the ground plane, four floats each — the whole of what
     *  the lookup below needs, and cheaper to scan than the vertices. */
    private readonly bounds: Float32Array;
    private readonly bucketMinX: number;
    private readonly bucketMinZ: number;
    private readonly bucketSize: number;
    private readonly bucketsX: number;
    private readonly bucketsZ: number;
    private readonly buckets: Int32Array[];

    constructor(data: NavMeshData) {
        this.verts = data.verts;
        this.polys = data.polys;
        this.neis = data.neis;
        this.polyCount = data.polyCount;
        this.maxVertsPerPoly = data.maxVertsPerPoly;
        this.agentRadius = data.agentRadius;
        this.snapDistance = data.snapDistance;
        this.verticalReach = data.verticalReach;
        this.areas = data.areas;

        this.bounds = new Float32Array(this.polyCount * 4);
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (let p = 0; p < this.polyCount; p++) {
            let pminX = Infinity, pminZ = Infinity, pmaxX = -Infinity, pmaxZ = -Infinity;
            const n = this.vertexCount(p);
            for (let i = 0; i < n; i++) {
                const v = this.polys[p * this.maxVertsPerPoly + i]! * 3;
                const x = this.verts[v]!;
                const z = this.verts[v + 2]!;
                if (x < pminX) pminX = x;
                if (x > pmaxX) pmaxX = x;
                if (z < pminZ) pminZ = z;
                if (z > pmaxZ) pmaxZ = z;
            }
            this.bounds[p * 4] = pminX;
            this.bounds[p * 4 + 1] = pminZ;
            this.bounds[p * 4 + 2] = pmaxX;
            this.bounds[p * 4 + 3] = pmaxZ;
            minX = Math.min(minX, pminX); maxX = Math.max(maxX, pmaxX);
            minZ = Math.min(minZ, pminZ); maxZ = Math.max(maxZ, pmaxZ);
        }

        // A square bucket grid, roughly one bucket per polygon: point lookup is
        // the only thing that walks the mesh without a poly to start from, and it
        // happens once per plan rather than once per step.
        const side = Math.max(1, Math.min(64, Math.round(Math.sqrt(this.polyCount || 1))));
        this.bucketMinX = Number.isFinite(minX) ? minX : 0;
        this.bucketMinZ = Number.isFinite(minZ) ? minZ : 0;
        const spanX = Number.isFinite(maxX) ? maxX - this.bucketMinX : 0;
        const spanZ = Number.isFinite(maxZ) ? maxZ - this.bucketMinZ : 0;
        this.bucketSize = Math.max(1, Math.max(spanX, spanZ) / side);
        this.bucketsX = side;
        this.bucketsZ = side;

        const lists: number[][] = Array.from({ length: side * side }, () => []);
        for (let p = 0; p < this.polyCount; p++) {
            const x0 = this.bucketX(this.bounds[p * 4]!);
            const x1 = this.bucketX(this.bounds[p * 4 + 2]!);
            const z0 = this.bucketZ(this.bounds[p * 4 + 1]!);
            const z1 = this.bucketZ(this.bounds[p * 4 + 3]!);
            for (let bz = z0; bz <= z1; bz++) {
                for (let bx = x0; bx <= x1; bx++) lists[bx + bz * side]!.push(p);
            }
        }
        this.buckets = lists.map(l => Int32Array.from(l));
    }

    /**
     * Say what an area costs to cross, against 1 for open ground. Cheap makes a
     * route prefer it and dear makes it go round; nothing here BLOCKS, because a
     * price an agent will not pay when there is another way is still a price it
     * pays when there is not.
     */
    setAreaCost(area: number, cost: number): void {
        if (area < 0 || area > 255) return;
        this.areaCost_[area] = cost > 0 ? cost : 1;
    }

    /** What crossing polygon `p` costs a unit of distance. */
    costOf(p: number): number {
        return this.areaCost_[this.areas[p] ?? 1] ?? 1;
    }

    /**
     * Join places the ground does not. Each segment is resolved to the polygons
     * under its two ends; one that reaches no ground at either end joins nothing
     * and is dropped, because a link to nowhere is a route that ends in the air.
     */
    connect(segments: readonly NavLinkSegment[]): void {
        this.links_ = [];
        this.linksFrom_ = new Map();
        const at = { x: 0, y: 0, z: 0 };
        for (const segment of segments) {
            const from = this.findPoly(segment.start, at, segment.radius);
            const start = { ...at };
            const to = this.findPoly(segment.end, at, segment.radius);
            if (from < 0 || to < 0 || from === to) continue;
            this.addLink({ from, to, start, end: { ...at } });
            if (segment.bidirectional) {
                this.addLink({ from: to, to: from, start: { ...at }, end: start });
            }
        }
    }

    /** How many links this mesh carries, counting each direction of a two-way one. */
    get linkCount(): number {
        return this.links_.length;
    }

    private addLink(edge: NavLinkEdge): void {
        const index = this.links_.push(edge) - 1;
        const list = this.linksFrom_.get(edge.from);
        if (list) list.push(index);
        else this.linksFrom_.set(edge.from, [index]);
    }

    /** How many corners polygon `p` actually has. */
    vertexCount(p: number): number {
        const base = p * this.maxVertsPerPoly;
        for (let i = 0; i < this.maxVertsPerPoly; i++) {
            if (this.polys[base + i] === -1) return i;
        }
        return this.maxVertsPerPoly;
    }

    /** World position of polygon `p`'s corner `i`, written into `out`. */
    corner(p: number, i: number, out: Vec3): Vec3 {
        const v = this.polys[p * this.maxVertsPerPoly + i]! * 3;
        out.x = this.verts[v]!;
        out.y = this.verts[v + 1]!;
        out.z = this.verts[v + 2]!;
        return out;
    }

    /** Whether `(x, z)` is inside polygon `p`, seen from above. */
    contains(p: number, x: number, z: number): boolean {
        const n = this.vertexCount(p);
        const base = p * this.maxVertsPerPoly;
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const vi = this.polys[base + i]! * 3;
            const vj = this.polys[base + j]! * 3;
            const zi = this.verts[vi + 2]!;
            const zj = this.verts[vj + 2]!;
            if ((zi > z) === (zj > z)) continue;
            const xi = this.verts[vi]!;
            const xj = this.verts[vj]!;
            if (x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
        }
        return inside;
    }

    /**
     * Height of polygon `p` at `(x, z)`. A convex polygon is not flat — its
     * corners came off a voxel grid — so the answer comes from the triangle of
     * the fan that covers the point, and from the nearest corner when the point
     * is outside every one of them.
     */
    heightAt(p: number, x: number, z: number): number {
        const n = this.vertexCount(p);
        const base = p * this.maxVertsPerPoly;
        const v0 = this.polys[base]! * 3;
        for (let i = 1; i + 1 < n; i++) {
            const v1 = this.polys[base + i]! * 3;
            const v2 = this.polys[base + i + 1]! * 3;
            const h = heightInTriangle(this.verts, v0, v1, v2, x, z);
            if (h !== null) return h;
        }
        let best = this.verts[v0 + 1]!;
        let bestD = Infinity;
        for (let i = 0; i < n; i++) {
            const v = this.polys[base + i]! * 3;
            const dx = this.verts[v]! - x;
            const dz = this.verts[v + 2]! - z;
            const d = dx * dx + dz * dz;
            if (d < bestD) { bestD = d; best = this.verts[v + 1]!; }
        }
        return best;
    }

    /**
     * The polygon a world point stands on, or -1. A point over more than one —
     * under a bridge, on a balcony — belongs to the floor nearest its own height,
     * which is the whole reason this mesh exists. `snap` overrides how far off the
     * mesh the point may be, for a caller that has its own idea of near.
     */
    findPoly(p: NavPoint, out?: Vec3, snap?: number): number {
        const x = p.x;
        const z = p.z ?? 0;
        const y = p.y;
        const reach = snap ?? this.snapDistance;
        let best = -1;
        let bestScore = Infinity;
        let bestY = 0;
        let nearest = -1;
        let nearestScore = reach * reach;
        let nearestX = 0, nearestY = 0, nearestZ = 0;

        const x0 = this.bucketX(x - reach);
        const x1 = this.bucketX(x + reach);
        const z0 = this.bucketZ(z - reach);
        const z1 = this.bucketZ(z + reach);
        for (let bz = z0; bz <= z1; bz++) {
            for (let bx = x0; bx <= x1; bx++) {
                for (const poly of this.buckets[bx + bz * this.bucketsX]!) {
                    if (x < this.bounds[poly * 4]! - reach || x > this.bounds[poly * 4 + 2]! + reach
                        || z < this.bounds[poly * 4 + 1]! - reach
                        || z > this.bounds[poly * 4 + 3]! + reach) continue;
                    if (this.contains(poly, x, z)) {
                        const h = this.heightAt(poly, x, z);
                        const score = Math.abs(h - y);
                        if (score <= this.verticalReach && score < bestScore) {
                            bestScore = score; best = poly; bestY = h;
                        }
                        continue;
                    }
                    if (best !== -1) continue;
                    const d = this.distanceToEdges(poly, x, y, z, EDGE_HIT);
                    if (d >= nearestScore) continue;
                    nearestScore = d;
                    nearest = poly;
                    nearestX = EDGE_HIT[0]!; nearestY = EDGE_HIT[1]!; nearestZ = EDGE_HIT[2]!;
                }
            }
        }

        if (best !== -1) {
            if (out) { out.x = x; out.y = bestY; out.z = z; }
            return best;
        }
        if (nearest !== -1 && out) { out.x = nearestX; out.y = nearestY; out.z = nearestZ; }
        return nearest;
    }

    /** Squared distance from a point to polygon `p`'s boundary, with the closest
     *  point on it written into `hit`. */
    private distanceToEdges(p: number, x: number, y: number, z: number, hit: Float64Array): number {
        const n = this.vertexCount(p);
        const base = p * this.maxVertsPerPoly;
        let best = Infinity;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const a = this.polys[base + j]! * 3;
            const b = this.polys[base + i]! * 3;
            const ax = this.verts[a]!, ay = this.verts[a + 1]!, az = this.verts[a + 2]!;
            const bx = this.verts[b]!, by = this.verts[b + 1]!, bz = this.verts[b + 2]!;
            const ex = bx - ax, ey = by - ay, ez = bz - az;
            const len = ex * ex + ey * ey + ez * ez;
            let t = len > 0 ? ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / len : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const cx = ax + ex * t, cy = ay + ey * t, cz = az + ez * t;
            const d = (cx - x) ** 2 + (cy - y) ** 2 + (cz - z) ** 2;
            if (d < best) { best = d; hit[0] = cx; hit[1] = cy; hit[2] = cz; }
        }
        return best;
    }

    findWorldPath(from: NavPoint, to: NavPoint, opts?: NavQueryOptions): Vec3[] | null {
        const radius = opts?.radius ?? 0;
        if (radius > this.agentRadius + 1e-3) warnRadius(radius, this.agentRadius);

        const start: Vec3 = { x: 0, y: 0, z: 0 };
        const end: Vec3 = { x: 0, y: 0, z: 0 };
        const startPoly = this.findPoly(from, start);
        // A goal off the mesh is still a direction to walk in. Only an agent that
        // is itself nowhere has no route at all.
        const endPoly = this.findPoly(to, end);
        if (startPoly < 0) return null;
        if (endPoly < 0) { end.x = to.x; end.y = to.y; end.z = to.z ?? 0; }
        if (startPoly === endPoly) return [start, end];

        const polyPath = this.findPolyPath(startPoly, endPoly, start, end);
        return this.routeThroughLinks(polyPath, start, polyPath.end);
    }

    /**
     * The taut route, broken at every link. A link joins two points and nothing
     * between them, so the funnel is run over each RUN of polygons the route walks
     * and the runs are joined end to end — pulling one taut across a link would cut
     * the corner off a ladder.
     */
    private routeThroughLinks(path: PolyPath, start: Vec3, end: Vec3): Vec3[] {
        const out: Vec3[] = [];
        let runFrom = 0;
        let runStart = start;
        for (let i = 0; i <= path.polys.length; i++) {
            const link = i < path.polys.length ? path.links[i]! : null;
            if (link === null || link < 0) continue;
            const edge = this.links_[link]!;
            append(out, this.straightPath(path.polys.slice(runFrom, i + 1), runStart, edge.start));
            append(out, [edge.end]);
            runFrom = i + 1;
            runStart = edge.end;
        }
        append(out, this.straightPath(path.polys.slice(runFrom), runStart, end));
        return out;
    }

    /**
     * A* over the polygon graph, keyed on where each doorway is crossed. A goal it
     * cannot reach yields the route to the polygon it got NEAREST: an agent sent
     * somewhere it cannot get to walks to the door, and the caller sees it fell
     * short because it named the goal itself.
     */
    private findPolyPath(startPoly: number, endPoly: number, start: Vec3, end: Vec3): PolyPath {
        const n = this.polyCount;
        const cost = new Float64Array(n).fill(Infinity);
        const parent = new Int32Array(n).fill(-1);
        /** Which link was taken to reach each polygon, or -1 for a shared edge. */
        const via = new Int32Array(n).fill(-1);
        const closed = new Uint8Array(n);
        // Where the search entered each polygon — a doorway midpoint, or the
        // start itself. Costs measured between these are what a route through
        // the polygon actually costs, rather than its centre-to-centre distance.
        const enterX = new Float64Array(n);
        const enterY = new Float64Array(n);
        const enterZ = new Float64Array(n);

        cost[startPoly] = 0;
        enterX[startPoly] = start.x; enterY[startPoly] = start.y; enterZ[startPoly] = start.z;
        let nearest = startPoly;
        let nearestScore = distance(start.x, start.y, start.z, end.x, end.y, end.z);
        const heap = new MinHeap(n);
        heap.push(startPoly, nearestScore);

        const a: Vec3 = { x: 0, y: 0, z: 0 };
        const b: Vec3 = { x: 0, y: 0, z: 0 };

        while (heap.size > 0) {
            const cur = heap.pop();
            if (cur === endPoly) break;
            if (closed[cur]) continue;
            closed[cur] = 1;

            const vcount = this.vertexCount(cur);
            for (let e = 0; e < vcount; e++) {
                const next = this.neis[cur * this.maxVertsPerPoly + e]!;
                if (next < 0 || closed[next]) continue;
                this.corner(cur, e, a);
                this.corner(cur, (e + 1) % vcount, b);
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                const mz = (a.z + b.z) / 2;
                const g = cost[cur]!
                    + distance(enterX[cur]!, enterY[cur]!, enterZ[cur]!, mx, my, mz)
                    * this.costOf(next);
                if (g >= cost[next]!) continue;
                cost[next] = g;
                parent[next] = cur;
                via[next] = -1;
                enterX[next] = mx; enterY[next] = my; enterZ[next] = mz;
                const toGoal = distance(mx, my, mz, end.x, end.y, end.z);
                if (toGoal < nearestScore) { nearestScore = toGoal; nearest = next; }
                heap.push(next, g + toGoal * HEURISTIC_SCALE);
            }

            // The ways the ground does not join: crossing one costs getting to the
            // near end and then the span itself.
            for (const li of this.linksFrom_.get(cur) ?? EMPTY_LINKS) {
                const link = this.links_[li]!;
                const next = link.to;
                if (closed[next]) continue;
                const g = cost[cur]!
                    + distance(enterX[cur]!, enterY[cur]!, enterZ[cur]!,
                        link.start.x, link.start.y, link.start.z) * this.costOf(cur)
                    + distance(link.start.x, link.start.y, link.start.z,
                        link.end.x, link.end.y, link.end.z) * this.costOf(next);
                if (g >= cost[next]!) continue;
                cost[next] = g;
                parent[next] = cur;
                via[next] = li;
                enterX[next] = link.end.x; enterY[next] = link.end.y; enterZ[next] = link.end.z;
                const toGoal = distance(link.end.x, link.end.y, link.end.z, end.x, end.y, end.z);
                if (toGoal < nearestScore) { nearestScore = toGoal; nearest = next; }
                heap.push(next, g + toGoal * HEURISTIC_SCALE);
            }
        }

        // Where the route actually finishes: the goal if it was reached, and the
        // nearest the search ever came to it if it was not.
        const reached = endPoly >= 0 && cost[endPoly]! < Infinity;
        const last = reached ? endPoly : nearest;
        const finish: Vec3 = reached
            ? end
            : { x: enterX[last]!, y: enterY[last]!, z: enterZ[last]! };
        const polys: number[] = [];
        const links: number[] = [];
        for (let p = last; p !== -1; p = parent[p]!) {
            polys.push(p);
            // The link recorded on a polygon is the one taken to REACH it, so it
            // belongs to the step out of the polygon before it.
            links.push(via[p]!);
            if (p === startPoly) break;
        }
        polys.reverse();
        links.reverse();
        // Shift by one: `links[i]` is now the step from `polys[i]` to `polys[i+1]`.
        links.shift();
        links.push(-1);
        return { polys, links, end: finish };
    }

    /**
     * Pull the route taut through the doorways it crosses — the funnel algorithm.
     * Without it a path is the chain of polygon midpoints the search happened to
     * visit; with it, it is the shortest line that stays inside them, and the
     * only corners left are the ones an agent really has to turn at.
     */
    private straightPath(polyPath: readonly number[], start: Vec3, end: Vec3): Vec3[] {
        const left: Vec3[] = [{ ...start }];
        const right: Vec3[] = [{ ...start }];
        for (let i = 0; i + 1 < polyPath.length; i++) {
            const from = polyPath[i]!;
            const to = polyPath[i + 1]!;
            const vcount = this.vertexCount(from);
            let edge = -1;
            for (let e = 0; e < vcount; e++) {
                if (this.neis[from * this.maxVertsPerPoly + e] === to) { edge = e; break; }
            }
            if (edge === -1) break;
            left.push(this.corner(from, edge, { x: 0, y: 0, z: 0 }));
            right.push(this.corner(from, (edge + 1) % vcount, { x: 0, y: 0, z: 0 }));
        }
        left.push({ ...end });
        right.push({ ...end });

        const out: Vec3[] = [{ ...start }];
        const atPortal: number[] = [0];
        let apex = start;
        let portalLeft = left[0]!;
        let portalRight = right[0]!;
        let apexIndex = 0;
        let leftIndex = 0;
        let rightIndex = 0;

        for (let i = 1; i < left.length; i++) {
            const l = left[i]!;
            const r = right[i]!;

            if (triArea2D(apex, portalRight, r) <= 0) {
                if (same(apex, portalRight) || triArea2D(apex, portalLeft, r) > 0) {
                    portalRight = r;
                    rightIndex = i;
                } else {
                    out.push({ ...portalLeft });
                    atPortal.push(leftIndex);
                    apex = portalLeft;
                    apexIndex = leftIndex;
                    portalLeft = apex;
                    portalRight = apex;
                    leftIndex = apexIndex;
                    rightIndex = apexIndex;
                    i = apexIndex;
                    continue;
                }
            }

            if (triArea2D(apex, portalLeft, l) >= 0) {
                if (same(apex, portalLeft) || triArea2D(apex, portalRight, l) < 0) {
                    portalLeft = l;
                    leftIndex = i;
                } else {
                    out.push({ ...portalRight });
                    atPortal.push(rightIndex);
                    apex = portalRight;
                    apexIndex = rightIndex;
                    portalLeft = apex;
                    portalRight = apex;
                    leftIndex = apexIndex;
                    rightIndex = apexIndex;
                    i = apexIndex;
                    continue;
                }
            }
        }

        if (!same(out[out.length - 1]!, end)) {
            out.push({ ...end });
            atPortal.push(left.length - 1);
        }
        return followGround(out, atPortal, left, right);
    }

    isNavigable(p: NavPoint): boolean {
        return this.findPoly(p) >= 0;
    }

    describe(sink: NavSurfaceSink): void {
        for (const link of this.links_) sink.link(link.start, link.end);
        const corners: Vec3[] = [];
        for (let p = 0; p < this.polyCount; p++) {
            const n = this.vertexCount(p);
            corners.length = 0;
            for (let i = 0; i < n; i++) corners.push(this.corner(p, i, { x: 0, y: 0, z: 0 }));
            sink.face(corners);
            for (let i = 0; i < n; i++) {
                if (this.neis[p * this.maxVertsPerPoly + i] !== -1) continue;
                sink.border(corners[i]!, corners[(i + 1) % n]!);
            }
        }
    }

    private bucketX(x: number): number {
        const b = Math.floor((x - this.bucketMinX) / this.bucketSize);
        return b < 0 ? 0 : b >= this.bucketsX ? this.bucketsX - 1 : b;
    }

    private bucketZ(z: number): number {
        const b = Math.floor((z - this.bucketMinZ) / this.bucketSize);
        return b < 0 ? 0 : b >= this.bucketsZ ? this.bucketsZ - 1 : b;
    }
}

/** A route as the search found it: the polygons walked, and for each step the
 *  link that made it, or -1 where the two polygons share an edge. */
interface PolyPath {
    polys: number[];
    links: number[];
    /** Where the route finishes, which is the goal only when it was reached. */
    end: Vec3;
}

const EMPTY_LINKS: readonly number[] = [];
const EDGE_HIT = new Float64Array(3);

/** Add waypoints, dropping one that repeats the point already there. */
function append(out: Vec3[], points: readonly Vec3[]): void {
    for (const p of points) {
        const last = out[out.length - 1];
        if (last && same(last, p) && Math.abs(last.y - p.y) < 1e-4) continue;
        out.push(p);
    }
}


/**
 * Put the taut route back on the ground. The funnel answers in the ground plane,
 * so one of its segments can cut straight over a hill the polygons under it
 * climb; every doorway it crosses has a known height there, and adding those back
 * follows the floor without bending anywhere the route did not already turn.
 */
function followGround(
    corners: Vec3[], atPortal: number[], left: Vec3[], right: Vec3[],
): Vec3[] {
    const out: Vec3[] = [corners[0]!];
    for (let k = 0; k + 1 < corners.length; k++) {
        const a = corners[k]!;
        const b = corners[k + 1]!;
        for (let q = atPortal[k]! + 1; q < atPortal[k + 1]!; q++) {
            const p = left[q]!;
            const r = right[q]!;
            const cross = crossSegments2D(a, b, p, r);
            if (!cross) continue;
            const y = p.y + (r.y - p.y) * cross.s;
            const lerped = a.y + (b.y - a.y) * cross.t;
            if (Math.abs(y - lerped) < GROUND_TOLERANCE) continue;
            out.push({ x: a.x + (b.x - a.x) * cross.t, y, z: a.z + (b.z - a.z) * cross.t });
        }
        out.push(b);
    }
    return out;
}

/** How far a route may float over or under the floor before a waypoint is put in
 *  to pull it down, in world pixels — a centimetre at a hundred to the metre. */
const GROUND_TOLERANCE = 1;

/** Where two segments cross in the ground plane, as the fraction along each. */
function crossSegments2D(a: Vec3, b: Vec3, p: Vec3, q: Vec3): { t: number; s: number } | null {
    const abx = b.x - a.x, abz = b.z - a.z;
    const pqx = q.x - p.x, pqz = q.z - p.z;
    const denom = abx * pqz - abz * pqx;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((p.x - a.x) * pqz - (p.z - a.z) * pqx) / denom;
    const s = ((p.x - a.x) * abz - (p.z - a.z) * abx) / denom;
    if (t <= 0 || t >= 1 || s < 0 || s > 1) return null;
    return { t, s };
}

function distance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
}

/** Twice the signed area of a triangle in the ground plane — the funnel's whole
 *  arithmetic, and the reason polygon winding has to be settled at bake time. */
function triArea2D(a: Vec3, b: Vec3, c: Vec3): number {
    return (c.x - a.x) * (b.z - a.z) - (b.x - a.x) * (c.z - a.z);
}

function same(a: Vec3, b: Vec3): boolean {
    return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.z - b.z) < 1e-4;
}

/** Height of `(x, z)` on the plane of a triangle, or null when it is outside. */
function heightInTriangle(
    verts: Float32Array, a: number, b: number, c: number, x: number, z: number,
): number | null {
    const ax = verts[a]!, az = verts[a + 2]!;
    const v0x = verts[c]! - ax, v0z = verts[c + 2]! - az;
    const v1x = verts[b]! - ax, v1z = verts[b + 2]! - az;
    const v2x = x - ax, v2z = z - az;
    const denom = v0x * v1z - v1x * v0z;
    if (Math.abs(denom) < 1e-9) return null;
    const u = (v1z * v2x - v1x * v2z) / denom;
    const v = (v0x * v2z - v0z * v2x) / denom;
    const epsilon = 1e-4;
    if (u < -epsilon || v < -epsilon || u + v > 1 + epsilon) return null;
    return verts[a + 1]! + (verts[c + 1]! - verts[a + 1]!) * u + (verts[b + 1]! - verts[a + 1]!) * v;
}

let radiusWarned = false;

/** Said once: an agent wider than the mesh was baked for is a bake setting to
 *  change, not a per-frame condition, and repeating it every plan would bury it. */
function warnRadius(radius: number, baked: number): void {
    if (radiusWarned) return;
    radiusWarned = true;
    log.warn('nav', `a NavAgent has radius ${radius} but the mesh was baked for ${baked}`
        + ' — routes will be planned as if it were the narrower one; raise the'
        + " NavVolume's agentRadius to plan for this agent");
}
