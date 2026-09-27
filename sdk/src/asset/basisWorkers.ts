// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  basisWorkers.ts — KTX2 transcoding on worker threads.
 *
 * A 2048² texture takes tens of milliseconds to transcode, and a scene loading a
 * few hundred of them spent that serially on the main thread: Bistro sat 24 s on
 * "Loading assets" with six loads in flight and one thread doing all the work.
 * Each worker instantiates the same basis side module and runs the same
 * {@link transcodeKtx2Levels}, built from its source text so there is one loop.
 */
import type { BasisTranscoder, CompressedTextureFormat, TranscodeResult, RgbaResult } from './compressed';
import { FORMAT_CODE, RGBA_CODE, transcodeKtx2Levels, transcoderFromModule, type BasisWasmModule } from './basisTranscoder';
import type { SideModuleHost, SideModuleSource } from '../sideModules/host';
import { log } from '../util/logger';


interface Pending {
    resolve(r: TranscodeResult | null): void;
    reject(e: Error): void;
}

function workerScript(): string {
    return `'use strict';
const transcodeKtx2Levels = ${transcodeKtx2Levels.toString()};
let ready = null;
self.onmessage = (e) => {
    const m = e.data;
    if (m.init) {
        // Instantiated as the main thread does it (host.ts instantiateWithBytes),
        // with the same gate, so a binary that will not compile fails the load
        // rather than leaving it waiting.
        ready = (async () => {
            importScripts(URL.createObjectURL(new Blob([m.glueText], { type: 'text/javascript' })));
            let fail;
            const gate = new Promise((_, reject) => { fail = reject; });
            const mod = await Promise.race([self[m.globalName]({
                instantiateWasm(imports, cb) {
                    WebAssembly.instantiate(m.wasmBytes, imports).then((r) => cb(r.instance, r.module), fail);
                    return {};
                },
            }), gate]);
            mod._es_basis_init();
            return mod;
        })();
        // Reported with the first transcode it fails, not as an unhandled rejection now.
        ready.catch(() => {});
        return;
    }
    ready.then((mod) => {
        const r = transcodeKtx2Levels(mod, m.bytes, m.code);
        self.postMessage({ id: m.id, result: r }, r ? r.levels.map((l) => l.data.buffer) : []);
    }).catch((err) => self.postMessage({ id: m.id, error: String(err && err.message || err) }));
};
`;
}

/**
 * A transcoder whose work runs on `count` workers, or null where this realm has
 * no `Worker` (mini-game hosts, node) — the caller then transcodes in place.
 */
export function createWorkerBasisTranscoder(source: SideModuleSource, count: number): BasisTranscoder | null {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
        return null;
    }
    const url = URL.createObjectURL(new Blob([workerScript()], { type: 'text/javascript' }));
    const pending = new Map<number, Pending>();
    let nextId = 1;
    const workers: Worker[] = [];
    try {
        for (let i = 0; i < Math.max(1, count); i++) {
            const w = new Worker(url);
            w.onmessage = (e: MessageEvent<{ id: number; result?: TranscodeResult | null; error?: string }>) => {
                const p = pending.get(e.data.id);
                if (!p) return;
                pending.delete(e.data.id);
                if (e.data.error !== undefined) p.reject(new Error(`transcode worker: ${e.data.error}`));
                else p.resolve(e.data.result ?? null);
            };
            // Each worker gets its own copy: a transferred buffer would leave the next one empty.
            w.postMessage({ init: true, glueText: source.glueText, globalName: source.globalName, wasmBytes: source.wasmBytes.slice(0) });
            workers.push(w);
        }
    } finally {
        URL.revokeObjectURL(url);
    }
    // Least-loaded, so one slow 4K texture does not queue the small ones behind it.
    const inFlight = new Array<number>(workers.length).fill(0);
    const run = (ktx2: Uint8Array, code: number): Promise<TranscodeResult | null> => {
        const i = inFlight.indexOf(Math.min(...inFlight));
        const id = nextId++;
        inFlight[i]++;
        return new Promise<TranscodeResult | null>((resolve, reject) => {
            pending.set(id, { resolve, reject });
            // A copy is sent, not the caller's buffer: the texture loader still
            // holds these bytes for its RGBA fallback.
            workers[i].postMessage({ id, bytes: ktx2, code });
        }).finally(() => { inFlight[i]--; });
    };
    return {
        transcode: (ktx2: Uint8Array, target: CompressedTextureFormat) => run(ktx2, FORMAT_CODE[target]),
        transcodeToRgba: (ktx2: Uint8Array) => run(ktx2, RGBA_CODE) as Promise<RgbaResult | null>,
    };
}

/** Workers to transcode on: the cores beside the main thread, at most four. */
function workerCount(): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 2 : 2;
    return Math.max(1, Math.min(4, cores - 1));
}

/**
 * The realm's KTX2 transcoder: its basis module on the main thread, and workers
 * in front of it where the host can hand over the module's source and the realm
 * has `Worker`. A worker that fails once (a CSP refusing blob workers, a module
 * that will not start) sends that load and every later one to the main thread.
 */
export function basisTranscoderFor(host: SideModuleHost | null | undefined): Promise<BasisTranscoder | null> {
    if (!host) return Promise.resolve(null);
    // One per realm: every loader that asks shares the same workers.
    let made = perHost.get(host);
    if (!made) {
        made = makeTranscoder(host);
        perHost.set(host, made);
    }
    return made;
}

const perHost = new WeakMap<SideModuleHost, Promise<BasisTranscoder | null>>();

async function makeTranscoder(host: SideModuleHost): Promise<BasisTranscoder | null> {
    const mod = await host.acquire('basis');
    if (!mod) return null;
    const main = transcoderFromModule(mod as unknown as BasisWasmModule);
    const source = host.source ? await host.source('basis').catch(() => null) : null;
    const workers = source ? createWorkerBasisTranscoder(source, workerCount()) : null;
    if (!workers) return main;
    let broken = false;
    const either = <R>(off: () => R | Promise<R>, on: () => R | Promise<R>): Promise<R> => {
        if (broken) return Promise.resolve(on());
        return Promise.resolve(off()).catch((e: unknown) => {
            broken = true;
            log.warn('asset', 'KTX2 transcoding moved back to the main thread: the transcode workers failed', e);
            return on();
        });
    };
    return {
        transcode: (ktx2, target) => either(() => workers.transcode(ktx2, target), () => main.transcode(ktx2, target)),
        transcodeToRgba: (ktx2) => either(() => workers.transcodeToRgba(ktx2), () => main.transcodeToRgba(ktx2)),
    };
}
