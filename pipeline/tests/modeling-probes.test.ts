// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bakeModel, bakeNormalMap, planNormalBake, prepareModeling, runProbes, type ModelStep, type NormalMap } from '../src/modeling';
import { probeOcclusion, probeRelief, reliefAt, reliefScratch } from '../src/modeling/normalBake';
import { openProbeCache } from '../src/modeling/probeCache';
import { probeCount } from '../src/modeling/probeWorkers';

beforeAll(() => prepareModeling());

const scratch = mkdtempSync(path.join(tmpdir(), 'estella-probes-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const slab: ModelStep = { id: 'slab', op: 'box', size: [4, 0.4, 4], color: [0, 0, 1], tag: 'slab' };
const plates: ModelStep = { id: 'dense', op: 'panels', faces: '+y', size: 1.3, gap: 0.16, height: 0.12, seed: 3, tag: 'plate' };
const thin: ModelStep = { op: 'decimate', from: 'slab', ratio: 1 };
const wear = (faces: string, color: number[] = [1, 0, 0]): ModelStep => ({ op: 'stain', texel: true, faces, where: 'edges', reach: 0.12, softness: 0.02, color });
const dirt: ModelStep = { op: 'stain', texel: true, where: 'cavity', reach: 0.3, softness: 0.05, color: [0, 1, 0], glow: 0.5 };

function source(stains: ModelStep[], size = 128): Record<string, unknown> {
    return { version: 1, normalBake: { from: 'dense', size, color: true, surface: true, occlusion: { size: 64, samples: 9 } }, steps: [slab, plates, ...stains, thin] };
}

const model = (stains: ModelStep[]) => bakeModel(source(stains) as never);

function maps(map: NormalMap): Uint8Array[] {
    return [map.rgba, map.colorRgba!, map.surfaceRgba!, map.occlusion!.rgba, ...(map.emissiveRgba ? [map.emissiveRgba] : [])];
}

describe('the probes a bake runs', () => {
    it('come out the same in pieces, in any order, as all at once', () => {
        const whole = bakeNormalMap(model([wear('plate'), dirt]));
        const plan = planNormalBake(model([wear('plate'), dirt]));
        expect(plan.probes.reliefs.map((relief) => relief.reach)).toEqual([0.12, 0.3]);
        const occlusion = plan.probes.occlusion!.todo.length;
        const half = Math.floor(occlusion / 2);
        for (let from = half; from < occlusion; from += 61) probeOcclusion(plan.probes, plan.tree, from, Math.min(from + 61, occlusion));
        for (let to = half; to > 0; to -= 97) probeOcclusion(plan.probes, plan.tree, Math.max(0, to - 97), to);
        plan.probes.reliefs.forEach((relief, index) => {
            for (let from = relief.todo.length; from > 0; from -= 333) probeRelief(plan.probes, plan.tree, index, Math.max(0, from - 333), from);
        });
        expect(maps(plan.finish())).toEqual(maps(whole));
    });

    it('refuse to finish over a probe that never ran', () => {
        const plan = planNormalBake(model([wear('plate')]));
        probeOcclusion(plan.probes, plan.tree, 0, plan.probes.occlusion!.todo.length);
        probeRelief(plan.probes, plan.tree, 0, 0, plan.probes.reliefs[0]!.todo.length - 1);
        expect(() => plan.finish()).toThrow(/never probed/);
    });

    it('are kept, so a second bake of the same surface runs none and paints the same', () => {
        const dir = path.join(scratch, 'kept');
        const first = planNormalBake(model([wear('plate'), dirt]));
        const fresh = openProbeCache(dir, 'slab', 128, first.probes);
        const asked = probeCount(first.probes);
        expect(fresh.reused).toBe(0);
        expect(asked).toBeGreaterThan(5000);
        runProbes(first.probes, first.tree);
        fresh.save();
        expect(readdirSync(dir).sort()).toEqual(['slab.128.occlusion.bin', 'slab.128.relief-0.bin', 'slab.128.relief-1.bin']);

        const again = planNormalBake(model([wear('plate', [1, 1, 0]), { ...dirt, softness: 0.2 }]));
        const warm = openProbeCache(dir, 'slab', 128, again.probes);
        expect(warm.reused).toBe(asked);
        expect(probeCount(again.probes)).toBe(0);
        expect(maps(again.finish())).toEqual(maps(bakeNormalMap(model([wear('plate', [1, 1, 0]), { ...dirt, softness: 0.2 }]))));
    });

    it('run only what a wider stain adds to what is kept', () => {
        const dir = path.join(scratch, 'wider');
        const narrow = planNormalBake(model([wear('plate')]));
        const some = probeCount(narrow.probes);
        const cache = openProbeCache(dir, 'slab', 128, narrow.probes);
        runProbes(narrow.probes, narrow.tree);
        cache.save();

        const wide = planNormalBake(model([wear('all')]));
        const all = probeCount(wide.probes);
        expect(all).toBeGreaterThan(some);
        const grown = openProbeCache(dir, 'slab', 128, wide.probes);
        expect(grown.reused).toBe(some);
        expect(probeCount(wide.probes)).toBe(all - some);
        runProbes(wide.probes, wide.tree);
        grown.save();
        expect(maps(wide.finish())).toEqual(maps(bakeNormalMap(model([wear('all')]))));

        const back = planNormalBake(model([wear('plate')]));
        expect(openProbeCache(dir, 'slab', 128, back.probes).reused).toBe(some);
        expect(probeCount(back.probes)).toBe(0);
    });

    it('are run again when the surface is another, or the file is not what was written', () => {
        const dir = path.join(scratch, 'other');
        const first = planNormalBake(model([wear('plate')]));
        const cache = openProbeCache(dir, 'slab', 128, first.probes);
        runProbes(first.probes, first.tree);
        cache.save();

        const moved = planNormalBake(bakeModel({ ...source([wear('plate')]), steps: [slab, { ...plates, seed: 4 }, wear('plate'), thin] } as never));
        expect(openProbeCache(dir, 'slab', 128, moved.probes).reused).toBe(0);

        const file = path.join(dir, 'slab.128.relief-0.bin');
        writeFileSync(file, readFileSync(file).subarray(0, 200));
        const cut = planNormalBake(model([wear('plate')]));
        const kept = openProbeCache(dir, 'slab', 128, cut.probes);
        expect(kept.reused).toBe(cut.probes.occlusion!.values.length);
        expect(probeCount(cut.probes)).toBe(cut.probes.reliefs[0]!.todo.length);
        expect(cut.probes.reliefs[0]!.todo.length).toBeGreaterThan(0);
    });
});

describe('the shape round a point', () => {
    it('is the same read from the triangles near it at once as from one ray after another', () => {
        const rough: ModelStep[] = [
            { id: 'ball', op: 'sphere', radius: 2, rings: 64, sides: 96, color: [0, 0, 1], tag: 'slab' },
            { id: 'dense', op: 'displace', pattern: 'bumps', scale: 0.4, amplitude: 0.12 },
            { op: 'decimate', from: 'ball', ratio: 0.2 },
        ];
        const plan = planNormalBake(bakeModel({ version: 1, normalBake: { from: 'dense', size: 64, color: true }, steps: [...rough.slice(0, 2), wear('all'), rough[2]!] } as never));
        const { corners, normals, triangles, places } = plan.probes;
        expect(corners.length / 9).toBeGreaterThan(5000);
        const [byRays, atOnce, both] = [reliefScratch(0), reliefScratch(100_000), reliefScratch()];
        let values = 0, bent = 0, mixed = 0;
        for (const reach of [0.05, 0.3, 1.5]) {
            for (let slot = 0; slot < triangles.length; slot += 3) {
                const hv = places[slot * 2]!, hw = places[slot * 2 + 1]!, hu = 1 - hv - hw, c = triangles[slot]! * 9;
                const at = [0, 1, 2].map((k) => hu * corners[c + k]! + hv * corners[c + 3 + k]! + hw * corners[c + 6 + k]!);
                const n = [0, 1, 2].map((k) => hu * normals[c + k]! + hv * normals[c + 3 + k]! + hw * normals[c + 6 + k]!);
                const nl = Math.hypot(n[0]!, n[1]!, n[2]!);
                const read = (scratch: ReturnType<typeof reliefScratch>): number => reliefAt(plan.tree, corners, at[0]!, at[1]!, at[2]!, n[0]! / nl, n[1]! / nl, n[2]! / nl, reach, scratch);
                const slow = read(byRays);
                if (!Object.is(read(atOnce), slow) || !Object.is(read(both), slow)) mixed++;
                values++;
                if (slow !== 0) bent++;
            }
        }
        expect(mixed).toBe(0);
        expect(values).toBeGreaterThan(400);
        expect(bent / values).toBeGreaterThan(0.5);
    });
});

describe('bake-model across threads', () => {
    const cli = fileURLToPath(new URL('../bin/estella.mjs', import.meta.url));
    const run = (dir: string, ...flags: string[]): { files: Record<string, Buffer>; probes: { computed: number; reused: number; jobs: number } } => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'slab.esmodel'), JSON.stringify(source([wear('plate'), dirt], 256)));
        const out = execFileSync(process.execPath, [cli, 'bake-model', path.join(dir, 'slab.esmodel'), ...flags], { encoding: 'utf8' });
        const files = Object.fromEntries(readdirSync(dir).filter((name) => /\.(png|esmesh|esmaterial)$/.test(name)).sort().map((name) => [name, readFileSync(path.join(dir, name))]));
        return { files, probes: JSON.parse(out.slice(out.indexOf('{\n'))).probes };
    };

    it('writes the files one thread writes, and keeps what it probed where the project keeps its cache', () => {
        const one = run(path.join(scratch, 'one'), '--jobs', '1');
        expect(one.probes).toMatchObject({ reused: 0, jobs: 1 });
        expect(one.probes.computed).toBeGreaterThan(20_000);
        expect(Object.keys(one.files)).toHaveLength(7);

        const project = path.join(scratch, 'project');
        mkdirSync(project, { recursive: true });
        writeFileSync(path.join(project, 'project.esproject'), '{}');
        const many = run(path.join(project, 'assets', 'models'), '--jobs', '3');
        expect(many.probes).toEqual({ computed: one.probes.computed, reused: 0, jobs: 3 });
        expect(many.files).toEqual(one.files);

        const warm = run(path.join(project, 'assets', 'models'), '--jobs', '3');
        expect(warm.probes).toEqual({ computed: 0, reused: one.probes.computed, jobs: 3 });
        expect(warm.files).toEqual(one.files);
        expect(readdirSync(path.join(project, '.esengine', 'cache', 'model-bake'))).toHaveLength(3);

        const cold = run(path.join(project, 'assets', 'models'), '--jobs', '2', '--no-cache');
        expect(cold.probes).toEqual({ computed: one.probes.computed, reused: 0, jobs: 2 });
    }, 120_000);
});
