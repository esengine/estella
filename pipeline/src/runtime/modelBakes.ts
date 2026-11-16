// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Backend, LoadWork, LoadWorkProgress } from 'esengine';
import { TIER_SIZE, bakeTierOf, deviceFacts, type BakeStage, type ModelBakesFile, type ModelMapName, type ModelProductRole } from '../modeling/loadBakeFile';
import type { BakeAsk, BakeReply } from './modelBakeWorker';

const MOST_WORKERS = 4;
const MESH_ONLY_SIZE = 128;
const PLACEHOLDER_SIZE = 4;
const STAGES: readonly [BakeStage, number][] = [['shape', 12], ['start', 6], ['surface', 6], ['shade', 8], ['plan', 10], ['relief', 34], ['occlusion', 6], ['paint', 9], ['finish', 9]];
const STAGE_TOTAL = STAGES.reduce((sum, [, weight]) => sum + weight, 0);
const NEUTRAL: Record<ModelMapName, readonly [number, number, number, number]> = {
    color: [72, 72, 76, 255],
    normal: [128, 128, 255, 255],
    surface: [255, 200, 0, 255],
    emissive: [0, 0, 0, 255],
    occlusion: [255, 255, 255, 255],
};

interface Pixels {
    width: number;
    height: number;
    pixels: Uint8Array;
}

type Reply<K extends string> = Extract<BakeReply, Record<K, unknown>>;

export interface ModelBakes {
    work: LoadWork;
    serve<S extends { backend: Backend; decodePixels?: (path: string, ...rest: never[]) => Promise<Pixels> }>(source: S): S;
    /** How a map that was drawn as a placeholder is drawn again once it is baked: the host asks its texture to be decoded anew. */
    refreshWith(refresh: (path: string) => Promise<void>): void;
}

const plain = (path: string): string => (path.startsWith('@') ? path : path.replace(/[?#].*$/, '').replace(/^(\.?\/)+/, ''));

const placeholder = (role: ModelMapName): Pixels => {
    const pixels = new Uint8Array(PLACEHOLDER_SIZE * PLACEHOLDER_SIZE * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set(NEUTRAL[role], i);
    return { width: PLACEHOLDER_SIZE, height: PLACEHOLDER_SIZE, pixels };
};

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
    const names = models.map((model) => model.source.replace(/^.*\//, '').replace(/\.esmodel$/i, ''));
    const share = new Float64Array(models.length);
    const meshes: Promise<Uint8Array>[] = [];
    const maps: Promise<Map<string, Pixels>>[] = [];
    const ready: (Map<string, Pixels> | null)[] = models.map(() => null);
    const shown = models.map(() => new Set<string>());
    const took: string[] = [];
    const watchers = new Set<(progress: LoadWorkProgress) => void>();
    let refresh: ((path: string) => Promise<void>) | null = null;
    let latest = '';
    let started = false;
    const tell = (): void => {
        if (watchers.size === 0) return;
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        const done = weights.reduce((sum, weight, index) => sum + weight * share[index]!, 0);
        for (const watcher of watchers) watcher({ done, total, label: latest });
    };

    const most = Math.max(1, Math.min(MOST_WORKERS, cores - 1, models.length));
    const pool: Worker[] = [];
    const answers = new Map<number, { index: number; resolve: (reply: BakeReply) => void; reject: (error: Error) => void }>();
    let asks = 0;
    const workerFor = (index: number): Worker => {
        const slot = index % most;
        let worker = pool[slot];
        if (!worker) {
            worker = new Worker(workerUrl);
            worker.addEventListener('message', (event: MessageEvent<BakeReply>) => {
                const reply = event.data, waiting = answers.get(reply.id);
                if (!waiting) return;
                if ('stage' in reply) {
                    let before = 0;
                    for (const [stage, weight] of STAGES) {
                        if (stage === reply.stage) { share[waiting.index] = Math.max(share[waiting.index]!, (before + weight * (reply.total > 0 ? reply.done / reply.total : 0)) / STAGE_TOTAL); break; }
                        before += weight;
                    }
                    latest = names[waiting.index]!;
                    tell();
                    return;
                }
                answers.delete(reply.id);
                if ('error' in reply) waiting.reject(new Error(`${models[waiting.index]!.source}: ${reply.error}`));
                else waiting.resolve(reply);
            });
            worker.addEventListener('error', (event: ErrorEvent) => {
                for (const [id, waiting] of answers) {
                    if (waiting.index % most !== slot) continue;
                    answers.delete(id);
                    waiting.reject(new Error(`${models[waiting.index]!.source}: the bake worker stopped: ${event.message}`));
                }
            });
            pool[slot] = worker;
        }
        return worker;
    };
    const ask = <T extends BakeReply>(index: number, part: 'shape' | 'maps'): Promise<T> => new Promise<T>((resolve, reject) => {
        const id = ++asks;
        answers.set(id, { index, resolve: resolve as (reply: BakeReply) => void, reject });
        workerFor(index).postMessage({ id, model: index, part, text: models[index]!.text, limit } satisfies BakeAsk);
    });

    const begin = (): void => {
        if (started) return;
        started = true;
        const order = models.map((_, index) => index).sort((a, b) => weights[b]! - weights[a]!);
        const began = performance.now();
        for (const index of order) meshes[index] = ask<Reply<'mesh'>>(index, 'shape').then((reply) => reply.mesh);
        for (const index of order) {
            maps[index] = ask<Reply<'maps'>>(index, 'maps').then(async (reply) => {
                const baked = new Map(reply.maps.map((map) => [map.name, { width: map.size, height: map.size, pixels: map.rgba }]));
                ready[index] = baked;
                share[index] = 1;
                took.push(`${names[index]} at ${((performance.now() - began) / 1000).toFixed(1)}s`);
                console.info(`[model-bake] ${took[took.length - 1]}`);
                latest = names[index]!;
                tell();
                if (refresh) for (const path of shown[index]!) await refresh(path).catch(() => undefined);
                shown[index]!.clear();
                return baked;
            });
        }
        void Promise.allSettled(maps).then(() => {
            console.info(`[model-bake] ${took.length} model(s) at ${limit} in ${((performance.now() - began) / 1000).toFixed(1)}s on ${most} worker(s): ${took.join(', ')}`);
        });
    };

    const work: LoadWork = {
        get pending() { return ready.some((done) => done === null); },
        release() {
            for (const baked of ready) baked?.clear();
        },
        async run(onProgress) {
            begin();
            if (onProgress) watchers.add(onProgress);
            try {
                tell();
                await Promise.all(maps);
                tell();
            } finally {
                if (onProgress) watchers.delete(onProgress);
            }
        },
    };

    return {
        work,
        refreshWith(next) {
            refresh = next;
        },
        serve(source) {
            begin();
            const inner = source.backend;
            const backend = Object.create(inner) as Backend;
            backend.fetchBinary = async (path: string): Promise<ArrayBuffer> => {
                const hit = owner.get(plain(path));
                if (!hit) return inner.fetchBinary(path);
                if (hit.role !== 'mesh') throw new Error(`${models[hit.model]!.source}: its ${hit.role} map is a picture, not a file`);
                const bytes = await meshes[hit.model]!;
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            };
            const decode = source.decodePixels;
            const decodePixels = async (path: string, ...rest: never[]): Promise<Pixels> => {
                const hit = owner.get(plain(path));
                if (!hit || hit.role === 'mesh') return decode!(path, ...rest);
                const baked = ready[hit.model];
                if (baked) {
                    const map = baked.get(hit.role);
                    if (map) return map;
                    return placeholder(hit.role);
                }
                shown[hit.model]!.add(path);
                return placeholder(hit.role);
            };
            return { ...source, backend, decodePixels };
        },
    };
}
