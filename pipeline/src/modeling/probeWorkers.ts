// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { probeOcclusion, probeRelief, runProbes, shadeTexels, stainPainter, type BakeProbes, type NormalBakePlan, type NormalBakeStart, type ShadeWork, type StainWork } from './normalBake';
import { TriangleTree, type TriangleTreeParts } from './triangleTree';

const TAG = 'estella-bake-probes';
const RELIEF_CHUNK = 1024;
const OCCLUSION_CHUNK = 256;
const STAIN_CHUNK = 4096;
const WORTH_SPREADING = 20_000;
const SHADE_WORTH_SPREADING = 16;

interface Shift {
    tag: typeof TAG;
    shading?: ShadeWork;
    probes?: BakeProbes;
    stains?: StainWork | null;
    corners: Float64Array;
    tree: TriangleTreeParts;
    cursors: Int32Array;
}

type Numbers = Uint8Array | Int32Array | Uint32Array | Float32Array | Float64Array;

function shared<T extends Numbers>(array: T): T {
    const out = new (array.constructor as new (buffer: SharedArrayBuffer) => T)(new SharedArrayBuffer(array.byteLength));
    (out as Uint8Array).set(array);
    return out;
}

export function probeCount(probes: BakeProbes): number {
    return probes.reliefs.reduce((sum, relief) => sum + relief.todo.length, 0) + (probes.occlusion?.todo.length ?? 0);
}

function each(cursors: Int32Array, cursor: number, length: number, chunk: number, run: (from: number, to: number) => void): void {
    for (;;) {
        const from = Atomics.add(cursors, cursor, chunk);
        if (from >= length) return;
        run(from, Math.min(from + chunk, length));
    }
}

function serve(shift: Shift, port: MessagePort): void {
    const { shading, probes, stains, cursors } = shift;
    const tree = new TriangleTree(shift.corners, shift.tree);
    if (shading) each(cursors, 0, shading.stats.length / 3, 1, (from, to) => shadeTexels(shading, tree, from, to));
    if (!probes) return;
    const reliefs = probes.reliefs.length;
    probes.reliefs.forEach((relief, index) => each(cursors, index, relief.todo.length, RELIEF_CHUNK, (from, to) => probeRelief(probes, tree, index, from, to)));
    if (probes.occlusion) each(cursors, reliefs, probes.occlusion.todo.length, OCCLUSION_CHUNK, (from, to) => probeOcclusion(probes, tree, from, to));
    if (!stains) return;
    port.once('message', () => {
        each(cursors, reliefs + 1, stains.slots.length, STAIN_CHUNK, stainPainter(stains, probes));
        port.close();
    });
    port.postMessage('probed');
}

function treeParts(tree: TriangleTree): TriangleTreeParts {
    const parts = tree.parts();
    return { order: shared(parts.order), boxes: shared(parts.boxes), links: shared(parts.links) };
}

async function spread(count: number, shift: Shift): Promise<void> {
    const file = fileURLToPath(import.meta.url);
    const workers = Array.from({ length: count }, () => new Worker(file, { workerData: shift, execArgv: [] }));
    let probed = 0;
    try {
        await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
            worker.once('error', reject);
            worker.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`a bake worker stopped with code ${code}`))));
            worker.on('message', () => {
                if (++probed === count) for (const other of workers) other.postMessage('paint');
            });
        })));
    } catch (error) {
        await Promise.all(workers.map((worker) => worker.terminate()));
        throw error;
    }
}

export async function shadeAcross(start: NormalBakeStart, jobs: number): Promise<void> {
    const { shading, tree } = start;
    const chunks = shading.stats.length / 3;
    const count = Math.min(Math.max(1, Math.floor(jobs)), chunks);
    if (count <= 1 || chunks < SHADE_WORTH_SPREADING) {
        shadeTexels(shading, tree, 0, chunks);
        return;
    }
    const corners = shared(shading.corners);
    const there: ShadeWork = {
        ...shading,
        indices: shared(shading.indices), P: shared(shading.P), N: shared(shading.N), T: shared(shading.T), UV: shared(shading.UV),
        cover: shared(shading.cover), corners, normals: shared(shading.normals), colors: shared(shading.colors), surfaces: shared(shading.surfaces),
        glows: shading.glows && shared(shading.glows), rgba: shared(shading.rgba),
        ...(shading.lowColors ? { lowColors: shared(shading.lowColors) } : {}),
        ...(shading.colorRgba ? { colorRgba: shared(shading.colorRgba) } : {}),
        ...(shading.surfaceRgba ? { surfaceRgba: shared(shading.surfaceRgba) } : {}),
        ...(shading.glow ? { glow: shared(shading.glow) } : {}),
        hitTriangle: shading.hitTriangle && shared(shading.hitTriangle),
        hitPlace: shading.hitPlace && shared(shading.hitPlace),
        stats: shared(shading.stats),
    };
    await spread(count, { tag: TAG, shading: there, corners, tree: treeParts(tree), cursors: new Int32Array(new SharedArrayBuffer(4)) });
    shading.rgba.set(there.rgba);
    shading.colorRgba?.set(there.colorRgba!);
    shading.surfaceRgba?.set(there.surfaceRgba!);
    shading.glow?.set(there.glow!);
    shading.hitTriangle?.set(there.hitTriangle!);
    shading.hitPlace?.set(there.hitPlace!);
    shading.stats.set(there.stats);
}

export async function runBakeAcross(plan: NormalBakePlan, jobs: number): Promise<number> {
    const { probes, stains, tree } = plan;
    const work = probeCount(probes) + (stains ? stains.slots.length : 0);
    const count = Math.min(Math.max(1, Math.floor(jobs)), Math.ceil(work / RELIEF_CHUNK));
    if (count <= 1 || work < WORTH_SPREADING) {
        runProbes(probes, tree);
        return 1;
    }
    const occlusion = probes.occlusion;
    const corners = shared(probes.corners);
    const there: BakeProbes = {
        corners,
        normals: shared(probes.normals),
        triangles: shared(probes.triangles),
        places: shared(probes.places),
        reliefs: probes.reliefs.map((relief) => ({ reach: relief.reach, values: shared(relief.values), todo: shared(relief.todo) })),
        ...(occlusion ? { occlusion: { ...occlusion, texels: shared(occlusion.texels), triangles: shared(occlusion.triangles), places: shared(occlusion.places), values: shared(occlusion.values), todo: shared(occlusion.todo) } } : {}),
    };
    const painted = stains && {
        ...stains,
        chosen: stains.chosen.map(shared),
        faceOf: shared(stains.faceOf),
        slots: shared(stains.slots),
        ...(stains.colorRgba ? { colorRgba: shared(stains.colorRgba) } : {}),
        ...(stains.surfaceRgba ? { surfaceRgba: shared(stains.surfaceRgba) } : {}),
        ...(stains.glow ? { glow: shared(stains.glow) } : {}),
    };
    await spread(count, { tag: TAG, probes: there, stains: painted, corners, tree: treeParts(tree), cursors: new Int32Array(new SharedArrayBuffer(4 * (probes.reliefs.length + 2))) });
    probes.reliefs.forEach((relief, index) => relief.values.set(there.reliefs[index]!.values));
    if (occlusion) occlusion.values.set(there.occlusion!.values);
    if (stains && painted) {
        stains.colorRgba?.set(painted.colorRgba!);
        stains.surfaceRgba?.set(painted.surfaceRgba!);
        stains.glow?.set(painted.glow!);
        stains.painted = true;
    }
    return count;
}

/** True on a thread this module started to share a bake, which a host that bundles it into a worker of its own has to tell from its own. */
export const inProbeWorker = !isMainThread && !!parentPort && (workerData as Partial<Shift> | null)?.tag === TAG;

if (inProbeWorker) serve(workerData as Shift, parentPort!);
