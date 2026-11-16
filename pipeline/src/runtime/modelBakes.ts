// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Backend, LoadWork, LoadWorkProgress } from 'esengine';
import { TIER_SIZE, bakeTierOf, deviceFacts, type BakeStage, type ModelBakesFile, type ModelProductRole } from '../modeling/loadBakeFile';
import type { BakeAsk, BakeReply } from './modelBakeWorker';

const MOST_WORKERS = 4;
const MESH_ONLY_SIZE = 128;
const STAGES: readonly [BakeStage, number][] = [['shape', 12], ['start', 6], ['surface', 6], ['shade', 8], ['plan', 10], ['relief', 34], ['occlusion', 6], ['paint', 9], ['finish', 9]];
const STAGE_TOTAL = STAGES.reduce((sum, [, weight]) => sum + weight, 0);

interface Pixels {
    width: number;
    height: number;
    pixels: Uint8Array;
}

interface Baked {
    mesh: Uint8Array | null;
    maps: Map<string, Pixels>;
}

export interface ModelBakes {
    work: LoadWork;
    serve<S extends { backend: Backend; decodePixels?: (path: string, ...rest: never[]) => Promise<Pixels> }>(source: S): S;
}

const plain = (path: string): string => (path.startsWith('@') ? path : path.replace(/[?#].*$/, '').replace(/^(\.?\/)+/, ''));

export function sizeLimit(search: string): number {
    const asked = Number(new URLSearchParams(search).get('bake'));
    return asked >= 64 && asked <= 8192 ? 2 ** Math.round(Math.log2(asked)) : TIER_SIZE[bakeTierOf(deviceFacts())];
}

export function createModelBakes(file: ModelBakesFile, workerUrl: string, limit: number, cores = 4): ModelBakes {
    const { models } = file;
    const owner = new Map<string, { model: number; role: ModelProductRole }>();
    models.forEach((model, index) => {
        for (const [role, paths] of Object.entries(model.products)) for (const path of [paths].flat()) owner.set(plain(path), { model: index, role: role as ModelProductRole });
    });
    const weights = models.map((model) => {
        const size = Number(/"normalBake":\{[^}]*?"size":(\d+)/.exec(model.text)?.[1] ?? MESH_ONLY_SIZE);
        return Math.min(size, limit) ** 2;
    });
    const share = new Float64Array(models.length);
    const baked: (Promise<Baked> | null)[] = models.map(() => null);
    const made = models.map(() => false);
    const took: string[] = [];
    const watchers = new Set<(progress: LoadWorkProgress) => void>();
    let latest = '';
    const tell = (): void => {
        if (watchers.size === 0) return;
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        const done = weights.reduce((sum, weight, index) => sum + weight * share[index]!, 0);
        for (const watcher of watchers) watcher({ done, total, label: latest });
    };

    const idle: Worker[] = [];
    const waiting: ((worker: Worker) => void)[] = [];
    let workers = 0, asks = 0;
    const most = Math.max(1, Math.min(MOST_WORKERS, cores - 1, models.length));
    const hire = (): Promise<Worker> => {
        const free = idle.pop();
        if (free) return Promise.resolve(free);
        if (workers < most) {
            workers++;
            return Promise.resolve(new Worker(workerUrl, { type: 'module' }));
        }
        return new Promise((resolve) => waiting.push(resolve));
    };
    const free = (worker: Worker): void => {
        const next = waiting.shift();
        if (next) next(worker);
        else idle.push(worker);
    };

    const bake = (index: number): Promise<Baked> => {
        const model = models[index]!;
        const name = model.source.replace(/^.*\//, '').replace(/\.esmodel$/i, '');
        return hire().then((worker) => new Promise<Baked>((resolve, reject) => {
            const id = ++asks, began = performance.now();
            const heard = (event: MessageEvent<BakeReply>): void => {
                const reply = event.data;
                if (reply.id !== id) return;
                if ('stage' in reply) {
                    let before = 0;
                    for (const [stage, weight] of STAGES) {
                        if (stage === reply.stage) { share[index] = Math.max(share[index]!, (before + weight * (reply.total > 0 ? reply.done / reply.total : 0)) / STAGE_TOTAL); break; }
                        before += weight;
                    }
                    latest = name;
                    tell();
                    return;
                }
                worker.removeEventListener('message', heard);
                worker.removeEventListener('error', failed);
                free(worker);
                if ('error' in reply) { reject(new Error(`${model.source}: ${reply.error}`)); return; }
                share[index] = 1;
                made[index] = true;
                took.push(`${name} ${((performance.now() - began) / 1000).toFixed(1)}s${reply.kept ? ' (kept)' : ''}`);
                latest = name;
                tell();
                resolve({ mesh: reply.mesh, maps: new Map(reply.maps.map((map) => [map.name, { width: map.size, height: map.size, pixels: map.rgba }])) });
            };
            const failed = (event: ErrorEvent): void => {
                worker.removeEventListener('message', heard);
                worker.removeEventListener('error', failed);
                workers--;
                reject(new Error(`${model.source}: the bake worker stopped: ${event.message}`));
            };
            worker.addEventListener('message', heard);
            worker.addEventListener('error', failed);
            worker.postMessage({ id, text: model.text, limit } satisfies BakeAsk);
        }));
    };
    const wanted = (index: number): Promise<Baked> => baked[index] ??= bake(index);

    const take = async (model: number, role: ModelProductRole): Promise<Uint8Array | Pixels> => {
        for (let attempt = 0; ; attempt++) {
            const result = await wanted(model);
            const piece = role === 'mesh' ? result.mesh : result.maps.get(role);
            if (role === 'mesh') result.mesh = null;
            else result.maps.delete(role);
            if (!result.mesh && result.maps.size === 0) baked[model] = null;
            if (piece) return piece;
            if (attempt > 0) throw new Error(`${models[model]!.source} bakes no ${role}`);
            baked[model] = null;
        }
    };

    let running: Promise<void> | null = null;
    const all = async (): Promise<void> => {
        const order = models.map((_, index) => index).sort((a, b) => weights[b]! - weights[a]!);
        const began = performance.now();
        await Promise.all(order.filter((index) => !made[index]).map((index) => wanted(index)));
        console.info(`[model-bake] ${took.length} model(s) at ${limit} in ${((performance.now() - began) / 1000).toFixed(1)}s on ${most} worker(s): ${took.join(', ')}`);
    };
    const work: LoadWork = {
        get pending() { return made.some((done) => !done); },
        async run(onProgress) {
            if (onProgress) watchers.add(onProgress);
            try {
                tell();
                await (running ??= all());
                tell();
            } finally {
                running = null;
                if (onProgress) watchers.delete(onProgress);
            }
        },
    };

    return {
        work,
        serve(source) {
            const inner = source.backend;
            const backend = Object.create(inner) as Backend;
            backend.fetchBinary = async (path: string): Promise<ArrayBuffer> => {
                const hit = owner.get(plain(path));
                if (!hit) return inner.fetchBinary(path);
                const bytes = await take(hit.model, hit.role) as Uint8Array;
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            };
            const decode = source.decodePixels;
            const decodePixels = async (path: string, ...rest: never[]): Promise<Pixels> => {
                const hit = owner.get(plain(path));
                if (hit) return await take(hit.model, hit.role) as Pixels;
                return decode!(path, ...rest);
            };
            return { ...source, backend, decodePixels };
        },
    };
}
