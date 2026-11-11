// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    gi-lab.test.ts
 * @brief   The distance-field + surface-cache + probe GI, solved on the CPU over the render lab's rooms, against Blender Cycles.
 *
 * The rooms are the ones tools/render-lab/gi_specs.py draws (boxes, one sun, no sky) and the numbers they are held to are
 * tools/render-lab/gi_reference.json: Cycles' linear light, 12 bounces, over a patch of each surface. What is asserted is the same
 * share of Cycles' light the lab check (gi_oracle.py) uses for the engine's other methods.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { MeshChannel, MeshChannelType, type MeshData } from 'esengine';
import { bakeMeshCards } from '../src/assets/meshCards';
import { bakeMeshSdf } from '../src/assets/meshSdf';
import { GlobalSdf } from '../../sdk/src/gi/globalSdf';
import { SurfaceCache, type PointLight } from '../../sdk/src/gi/surfaceCache';
import { solveBounces, type ProbeScene } from '../../sdk/src/gi/screenProbes';

const reference = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../tools/render-lab/gi_reference.json'), 'utf8')).regions as Record<string, Record<string, number[]>>;

type Box = { centre: [number, number, number]; size: [number, number, number]; colour: [number, number, number]; emissive?: [number, number, number] };

// The lab's numbers (gi_specs.py), in centimetres.
const W = 400, H = 300, D = 500, T = 10;
const WHITE: [number, number, number] = [0.85, 0.85, 0.85], RED: [number, number, number] = [0.8, 0.18, 0.15], GREEN: [number, number, number] = [0.18, 0.7, 0.22];
function room(skylightZ?: number): Box[] {
    const hw = W / 2, hd = D / 2;
    const b: Box[] = [
        { centre: [0, -T / 2, 0], size: [W + 2 * T, T, D + 2 * T], colour: WHITE },
        { centre: [hw + T / 2, H / 2, 0], size: [T, H, D], colour: RED },
        { centre: [-hw - T / 2, H / 2, 0], size: [T, H, D], colour: GREEN },
        { centre: [0, H / 2, hd + T / 2], size: [W + 2 * T, H, T], colour: WHITE },
        { centre: [0, H / 2, -hd - T / 2], size: [W + 2 * T, H, T], colour: WHITE },
    ];
    if (skylightZ === undefined) b.push({ centre: [0, H + T / 2, 0], size: [W + 2 * T, T, D + 2 * T], colour: WHITE });
    else {
        const sx = 120, sz = 120, z0 = skylightZ - sz / 2, z1 = skylightZ + sz / 2, zlo = -hd - T, zhi = hd + T;
        b.push(
            { centre: [0, H + T / 2, (zlo + z0) / 2], size: [W + 2 * T, T, z0 - zlo], colour: WHITE },
            { centre: [0, H + T / 2, (z1 + zhi) / 2], size: [W + 2 * T, T, zhi - z1], colour: WHITE },
            { centre: [(hw + T + sx / 2) / 2, H + T / 2, skylightZ], size: [hw + T - sx / 2, T, sz], colour: WHITE },
            { centre: [-(hw + T + sx / 2) / 2, H + T / 2, skylightZ], size: [hw + T - sx / 2, T, sz], colour: WHITE },
        );
    }
    b.push({ centre: [-90, 50, 80], size: [100, 100, 100], colour: WHITE });
    return b;
}

function boxMesh(size: [number, number, number]): MeshData {
    const h = size.map((s) => s / 2), p: number[] = [];
    for (let i = 0; i < 8; i++) p.push((i & 1 ? 1 : -1) * h[0]!, (i & 2 ? 1 : -1) * h[1]!, (i & 4 ? 1 : -1) * h[2]!);
    const idx: number[] = [];
    for (const [a, b, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]] as [number, number, number, number][]) {
        const pa = p.slice(a * 3, a * 3 + 3), pb = p.slice(b * 3, b * 3 + 3), pc = p.slice(c * 3, c * 3 + 3);
        const u = pb.map((v, k) => v - pa[k]!), w = pc.map((v, k) => v - pa[k]!);
        const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
        idx.push(...(n[0]! * pa[0]! + n[1]! * pa[1]! + n[2]! * pa[2]! > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
    }
    const vertices = new Uint8Array(8 * 12), view = new DataView(vertices.buffer);
    p.forEach((v, i) => view.setFloat32(i * 4, v, true));
    return { channels: [{ semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 }], vertexStride: 12, vertexCount: 8, vertices,
        indices: new Uint32Array(idx), aabbMin: [-h[0]!, -h[1]!, -h[2]!], aabbMax: [h[0]!, h[1]!, h[2]!] };
}

const matrix = (t: [number, number, number]): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];

// The sun of the lab: 68 degrees up, heading 20 degrees from +Z toward +X (the direction the light travels is gi_specs.sun_dir).
const sunTravel = (elev: number, azim: number): [number, number, number] => {
    const e = (elev * Math.PI) / 180, a = (azim * Math.PI) / 180;
    return [Math.cos(e) * Math.sin(a), -Math.sin(e), Math.cos(e) * Math.cos(a)];
};

function solve(boxes: Box[], sun: { elev: number; azim: number } | null, bounces = 4, raysSeed = 0, lights: PointLight[] = []) {
    const sdf = new GlobalSdf([{ dim: 128, cell: 5 }]);
    sdf.setCenter([0, 150, 0]);
    const cache = new SurfaceCache();
    boxes.forEach((b, id) => {
        const mesh = boxMesh(b.size);
        const field = bakeMeshSdf(mesh, { cellSize: 10 })!;
        sdf.update({ id, sdf: field, worldFromLocal: matrix(b.centre) });
        cache.add({ id, cards: bakeMeshCards(mesh, { cell: 25, maxResolution: 24, baseColor: b.colour, emissive: b.emissive })!, worldFromLocal: matrix(b.centre) });
    });
    const scene: ProbeScene = { sdf, cache, range: 900, bias: 9, tolerance: 14 };
    const travel = sun ? sunTravel(sun.elev, sun.azim) : null;
    solveBounces(scene, { sun: travel ? { toLight: [-travel[0], -travel[1], -travel[2]], radiance: [1, 1, 1] } : undefined, lights, sdf, bias: 9, shadowRange: 900 }, bounces);
    void raysSeed;
    return { cache, sdf };
}

/** The share of Cycles' light the cache gives a patch: weighted by the light, as gi_oracle.py reads it. */
function share(cache: SurfaceCache, point: [number, number, number], normal: [number, number, number], ref: number[]): { e: number[]; share: number } {
    const lift: [number, number, number] = [point[0] + normal[0] * 4, point[1] + normal[1] * 4, point[2] + normal[2] * 4];
    const e = cache.lookup(lift, [-normal[0], -normal[1], -normal[2]], 14) ?? [0, 0, 0];
    return { e, share: (e[0]! * ref[0]! + e[1]! * ref[1]! + e[2]! * ref[2]!) / (ref[0]! ** 2 + ref[1]! ** 2 + ref[2]! ** 2) };
}

describe('the dynamic GI over the render lab rooms', () => {
    it('keeps a sealed room dark: the sun on its outside reaches nothing within', () => {
        const { cache } = solve(room(), { elev: 40, azim: 60 });
        const inside = [
            [[0, 299, 150], [0, -1, 0]], [[199, 120, 120], [-1, 0, 0]], [[-199, 120, 120], [1, 0, 0]], [[60, 200, 249], [0, 0, -1]], [[100, 1, 150], [0, 1, 0]],
        ].map(([p, n]) => Math.max(...share(cache, p as [number, number, number], n as [number, number, number], [1, 1, 1]).e));
        const worst = Math.max(...inside);
        console.log('leak: brightest inside', worst);
        expect(worst).toBeLessThan(1e-4);
    }, 120000);

    it('puts the bounce of a skylit room where Cycles does, on and off the screen', () => {
        const { cache } = solve(room(60), { elev: 68, azim: 20 }, 5);
        const rows: Array<[string, [number, number, number], [number, number, number]]> = [
            ['ceiling', [0, 299, 150], [0, -1, 0]], ['red wall', [199, 120, 120], [-1, 0, 0]], ['green wall', [-199, 120, 120], [1, 0, 0]],
            ['back wall', [60, 200, 249], [0, 0, -1]], ['floor in shade', [120, 1, 200], [0, 1, 0]], ['block, shaded face', [-90, 50, 29], [0, 0, -1]],
        ];
        const shares = rows.map(([name, p, n]) => {
            const s = share(cache, p, n, reference.gi_room![name]!);
            console.log(`gi_room  ${name.padEnd(20)} cycles ${reference.gi_room![name]!.map((v) => v.toFixed(3)).join(' ')}  engine ${s.e.map((v) => v.toFixed(3)).join(' ')}  share ${s.share.toFixed(2)}`);
            return s.share;
        });
        const away: Array<[string, [number, number, number], [number, number, number]]> = [
            ['front wall', [0, 170, -249], [0, 0, 1]], ['ceiling', [0, 299, -100], [0, -1, 0]], ['red wall', [199, 150, -100], [-1, 0, 0]], ['green wall', [-199, 150, -100], [1, 0, 0]],
        ];
        const awayShares = away.map(([name, p, n]) => {
            const s = share(cache, p, n, reference.gi_away![name]!);
            console.log(`gi_away  ${name.padEnd(20)} cycles ${reference.gi_away![name]!.map((v) => v.toFixed(3)).join(' ')}  engine ${s.e.map((v) => v.toFixed(3)).join(' ')}  share ${s.share.toFixed(2)}`);
            return s.share;
        });
        // Measured 2026-11-11: 0.46 to 1.89 of Cycles' light (the cards are 25 cm, a probe is 64 rays), on screen and off alike. The voxel method
        // is 0.1 to 1.7 on screen and 0.3 to 0.5 off it; the band is the accuracy this has today, so a change that makes it worse fails.
        for (const s of [...shares, ...awayShares]) { expect(s).toBeGreaterThan(0.4); expect(s).toBeLessThan(2.0); }
    }, 300000);

    it('lights the room of gi_point by a lamp: the CPU reference the GPU method is held to', () => {
        // The lamp of tools/render-lab/gi_specs.py: at (0, 200, 50), intensity 0.3 (an 8-bit picture cannot hold more), linear falloff to 600.
        const lamp: PointLight = { position: [0, 200, 50], radiance: [0.3, 0.3, 0.3], reach: 600, innerRadius: 0, falloff: 1 };
        const { cache } = solve(room(), null, 5, 0, [lamp]);
        const rows: Array<[string, [number, number, number], [number, number, number]]> = [
            ['ceiling', [0, 299, 50], [0, -1, 0]], ['red wall', [199, 150, 50], [-1, 0, 0]], ['green wall', [-199, 150, 50], [1, 0, 0]],
            ['back wall', [0, 150, 249], [0, 0, -1]], ['floor', [0, 1, 50], [0, 1, 0]], ['block, lit side', [-90, 50, 29], [0, 0, -1]],
        ];
        const out: Record<string, number[]> = {};
        for (const [name, p, n] of rows) {
            const e = share(cache, p, n, [1, 1, 1]).e;
            out[name] = e;
            console.log(`gi_point ${name.padEnd(16)} ${e.map((v) => v.toFixed(3)).join(' ')}`);
            expect(Math.max(...e)).toBeGreaterThan(0.02);
        }
        if (process.env.WRITE_REF) writeFileSync(path.resolve(import.meta.dirname, '../../tools/render-lab/gi_point_reference.json'), JSON.stringify({ source: 'the CPU solver of pipeline/tests/gi-lab.test.ts (distance field + surface cache + probes, 5 bounces), linear radiance at each region', regions: out }, null, 1));
    }, 300000);

    it('lights the room of gi_spot by a spot aimed down: the CPU reference for the cone', () => {
        // tools/render-lab/gi_specs.py: at (0, 250, 50), aimed straight down, 25 degrees inner and 50 outer (full angles), intensity 0.5, linear falloff to 600.
        const half = (deg: number) => Math.cos((deg * Math.PI) / 360);
        const spot: PointLight = { position: [0, 250, 50], radiance: [0.5, 0.5, 0.5], reach: 600, innerRadius: 0, falloff: 1, spot: { axis: [0, -1, 0], innerCos: half(25), outerCos: half(50) } };
        const { cache } = solve(room(), null, 5, 0, [spot]);
        const rows: Array<[string, [number, number, number], [number, number, number]]> = [
            ['floor, in the cone', [0, 1, 50], [0, 1, 0]], ['floor, penumbra', [98, 1, 50], [0, 1, 0]], ['floor, out of the cone', [170, 1, 50], [0, 1, 0]],
            ['back wall', [0, 150, 249], [0, 0, -1]], ['red wall', [199, 150, 50], [-1, 0, 0]], ['ceiling', [0, 299, 50], [0, -1, 0]],
        ];
        const out: Record<string, number[]> = {};
        for (const [name, p, n] of rows) {
            const e = share(cache, p, n, [1, 1, 1]).e;
            out[name] = e;
            console.log(`gi_spot ${name.padEnd(24)} ${e.map((v) => v.toFixed(3)).join(' ')}`);
            expect(Math.max(...e)).toBeGreaterThan(0.005);
        }
        // The cone is the point: the floor in it is far brighter than the floor out of it, which only bounce reaches.
        expect(out['floor, in the cone']![1]!).toBeGreaterThan(4 * out['floor, out of the cone']![1]!);
        if (process.env.WRITE_REF) writeFileSync(path.resolve(import.meta.dirname, '../../tools/render-lab/gi_spot_reference.json'), JSON.stringify({ source: 'the CPU solver of pipeline/tests/gi-lab.test.ts (distance field + surface cache + probes, 5 bounces), linear radiance at each region', regions: out }, null, 1));
    }, 300000);
});
