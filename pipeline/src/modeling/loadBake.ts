// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { encodeMesh } from '../../../sdk/src/asset/meshFormat';
import { MeshoptSimplifier } from 'meshoptimizer';
import { GpuProbes, gpuNormalBake, warmBakePrograms } from './gpuProbes';
import { bakeModel } from './modelBake';
import { validateModelSource } from './modelSource';
import { MODEL_MAPS, type BakeStage, type ModelMapName } from './loadBakeFile';

const MIN_SIZE = 64;
const MIN_OCCLUSION = 128;
const CACHE_NAME = 'estella-model-bake';
const CACHE_VERSION = 1;

export interface LoadedModel {
    maps: Partial<Record<ModelMapName, { size: number; rgba: Uint8Array }>>;
}


function sized(raw: unknown, limit: number): unknown {
    const source = structuredClone(raw) as { normalBake?: { size: number; occlusion?: { size?: number } } };
    const detail = source.normalBake;
    if (!detail || detail.size <= limit) return source;
    const share = Math.max(MIN_SIZE, limit) / detail.size;
    detail.size = Math.max(MIN_SIZE, limit);
    if (detail.occlusion?.size) detail.occlusion.size = Math.max(MIN_OCCLUSION, 2 ** Math.round(Math.log2(detail.occlusion.size * share)));
    return source;
}

export const canBakeAtLoad = (gl: WebGL2RenderingContext | null): gl is WebGL2RenderingContext => !!gl && GpuProbes.supported(gl);

async function keyOf(text: string, limit: number): Promise<string> {
    const bytes = new TextEncoder().encode(`${CACHE_VERSION}:${limit}:${text}`);
    if (globalThis.crypto?.subtle) {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    let a = 0x811c9dc5, b = 0x1b873593;
    for (const byte of bytes) { a = Math.imul(a ^ byte, 16777619); b = Math.imul(b + byte, 2246822519) ^ (b >>> 13); }
    return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}${bytes.length.toString(16)}`;
}

const through = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> =>
    new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).arrayBuffer());

interface Kept {
    packed: boolean;
    mesh: Uint8Array;
    maps: { name: ModelMapName; size: number; bytes: Uint8Array }[];
}

function store(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        try {
            const open = indexedDB.open(CACHE_NAME, 1);
            open.onupgradeneeded = () => open.result.createObjectStore('models');
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => resolve(null);
            open.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

const request = <T>(made: IDBRequest<T>): Promise<T | undefined> => new Promise((resolve) => {
    made.onsuccess = () => resolve(made.result);
    made.onerror = () => resolve(undefined);
});

export interface ShapedModel {
    mesh: Uint8Array;
    kept: boolean;
    maps(tick?: (stage: BakeStage, done: number, total: number) => void): Promise<{ maps: LoadedModel['maps']; keep(): Promise<void> }>;
}

export async function shapeModelAtLoad(gl: WebGL2RenderingContext, text: string, limit: number, tick?: (stage: BakeStage, done: number, total: number) => void): Promise<ShapedModel> {
    const [db, key] = await Promise.all([store(), keyOf(text, limit)]);
    const packs = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
    const kept = db ? await request<Kept>(db.transaction('models').objectStore('models').get(key)) : undefined;
    if (kept && (!kept.packed || packs)) {
        db?.close();
        return {
            mesh: kept.mesh, kept: true,
            async maps() {
                const maps: LoadedModel['maps'] = {};
                for (const map of kept.maps) maps[map.name] = { size: map.size, rgba: kept.packed ? await through(map.bytes, new DecompressionStream('deflate-raw')) : map.bytes };
                return { maps, keep: async () => undefined };
            },
        };
    }
    await MeshoptSimplifier.ready;
    tick?.('shape', 0, 1);
    const baked = bakeModel(validateModelSource(sized(JSON.parse(text), limit)));
    tick?.('shape', 1, 1);
    const mesh = encodeMesh(baked.data);
    return {
        mesh, kept: false,
        async maps(step) {
            const maps: LoadedModel['maps'] = {};
            if (baked.detail) {
                warmBakePrograms(gl);
                const map = await gpuNormalBake(gl, baked, step);
                maps.normal = { size: map.size, rgba: map.rgba };
                if (map.colorRgba) maps.color = { size: map.size, rgba: map.colorRgba };
                if (map.surfaceRgba) maps.surface = { size: map.size, rgba: map.surfaceRgba };
                if (map.emissiveRgba) maps.emissive = { size: map.size, rgba: map.emissiveRgba };
                if (map.occlusion) maps.occlusion = map.occlusion;
            }
            const keep = async (): Promise<void> => {
                if (!db) return;
                const packed: Kept['maps'] = [];
                for (const name of MODEL_MAPS) {
                    const m = maps[name];
                    if (m) packed.push({ name, size: m.size, bytes: packs ? await through(m.rgba, new CompressionStream('deflate-raw')) : m.rgba });
                }
                try {
                    await request(db.transaction('models', 'readwrite').objectStore('models').put({ packed: packs, mesh, maps: packed } satisfies Kept, key));
                } catch {
                    void 0;
                }
                db.close();
            };
            return { maps, keep };
        },
    };
}
