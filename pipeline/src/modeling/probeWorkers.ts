// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { probeOcclusion, probeRelief, runProbes, stainPainter, type BakeProbes, type NormalBakePlan, type StainWork } from './normalBake';
import { TriangleTree, type TriangleTreeParts } from './triangleTree';

const TAG = 'estella-bake-probes';
const RELIEF_CHUNK = 1024;
const OCCLUSION_CHUNK = 256;
const STAIN_CHUNK = 4096;
const WORTH_SPREADING = 20_000;

interface Shift {
    tag: typeof TAG;
    probes: BakeProbes;
    stains: StainWork | null;
    tree: TriangleTreeParts;
    cursors: Int32Array;
}

type Numbers = Uint8Array | Int32Array | Float32Array | Float64Array;

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
    const { probes, stains, cursors } = shift;
    const tree = new TriangleTree(probes.corners, shift.tree);
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

export async function runBakeAcross(plan: NormalBakePlan, jobs: number): Promise<number> {
    const { probes, stains, tree } = plan;
    const work = probeCount(probes) + (stains ? stains.slots.length : 0);
    const count = Math.min(Math.max(1, Math.floor(jobs)), Math.ceil(work / RELIEF_CHUNK));
    if (count <= 1 || work < WORTH_SPREADING) {
        runProbes(probes, tree);
        return 1;
    }
    const parts = tree.parts();
    const occlusion = probes.occlusion;
    const shift: Shift = {
        tag: TAG,
        probes: {
            corners: shared(probes.corners),
            normals: shared(probes.normals),
            triangles: shared(probes.triangles),
            places: shared(probes.places),
            reliefs: probes.reliefs.map((relief) => ({ reach: relief.reach, values: shared(relief.values), todo: shared(relief.todo) })),
            ...(occlusion ? { occlusion: { ...occlusion, texels: shared(occlusion.texels), triangles: shared(occlusion.triangles), places: shared(occlusion.places), values: shared(occlusion.values), todo: shared(occlusion.todo) } } : {}),
        },
        stains: stains && {
            ...stains,
            chosen: stains.chosen.map(shared),
            faceOf: shared(stains.faceOf),
            slots: shared(stains.slots),
            ...(stains.colorRgba ? { colorRgba: shared(stains.colorRgba) } : {}),
            ...(stains.surfaceRgba ? { surfaceRgba: shared(stains.surfaceRgba) } : {}),
            ...(stains.glow ? { glow: shared(stains.glow) } : {}),
        },
        tree: { order: shared(parts.order), boxes: shared(parts.boxes), links: shared(parts.links) },
        cursors: new Int32Array(new SharedArrayBuffer(4 * (probes.reliefs.length + 2))),
    };
    const file = fileURLToPath(import.meta.url);
    const workers = Array.from({ length: count }, () => new Worker(file, { workerData: shift }));
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
    probes.reliefs.forEach((relief, index) => relief.values.set(shift.probes.reliefs[index]!.values));
    if (occlusion) occlusion.values.set(shift.probes.occlusion!.values);
    if (stains && shift.stains) {
        stains.colorRgba?.set(shift.stains.colorRgba!);
        stains.surfaceRgba?.set(shift.stains.surfaceRgba!);
        stains.glow?.set(shift.stains.glow!);
        stains.painted = true;
    }
    return count;
}

if (!isMainThread && parentPort && (workerData as Partial<Shift> | null)?.tag === TAG) serve(workerData as Shift, parentPort);
