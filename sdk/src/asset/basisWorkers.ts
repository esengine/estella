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
import type { BasisLevelOptions, BasisTranscoder, TranscodeResult } from './compressed';
import { FORMAT_CODE, RGBA_CODE, transcodeKtx2Levels, type BasisWasmModule } from './basisTranscoder';
import type { SideModuleHost, SideModuleSource } from '../sideModules/host';
import { instantiateWasmModule } from '../wasm/instantiateModule';
import { log } from '../util/logger';
import { createJobPool, createJobs } from '../runtime/jobs';


function workerScript(): string {
    return `'use strict';
const transcodeKtx2Levels = ${transcodeKtx2Levels.toString()};
const instantiateWasmModule = ${instantiateWasmModule.toString()};
let ready = null;
self.onmessage = (e) => {
    const m = e.data;
    if (m.init) {
        // Instantiated as the main thread does it (host.ts instantiateWithBytes),
        // with the same gate, so a binary that will not compile fails the load
        // rather than leaving it waiting.
        ready = (async () => {
            importScripts(URL.createObjectURL(new Blob([m.glueText], { type: 'text/javascript' })));
            const mod = await instantiateWasmModule(self[m.globalName], imports => WebAssembly.instantiate(m.wasmBytes, imports));
            mod._es_basis_init();
            return mod;
        })();
        // Reported with the first transcode it fails, not as an unhandled rejection now.
        ready.catch(() => {});
        return;
    }
    // A module that would not start can do no job: said as \`lost\`, so the pool stops sending them here.
    ready.then((mod) => {
        try {
            const r = transcodeKtx2Levels(mod, m.bytes, m.code, m.options);
            self.postMessage({ id: m.id, result: r }, r ? r.levels.map((l) => l.data.buffer) : []);
        } catch (err) {
            self.postMessage({ id: m.id, error: String(err && err.message || err) });
        }
    }, (err) => self.postMessage({ id: m.id, error: String(err && err.message || err), lost: true }));
};
`;
}

/** A transcoder that owns threads, and so has to be told when it is done with. */
export interface WorkerBasisTranscoder extends BasisTranscoder {
    /** Stop the workers. What is still in flight settles as "no result"; later calls do too. Idempotent. */
    dispose(): void;
}

/** The pool's part of a transcoder on workers: its script, and the module each worker is greeted with. */
function basisPoolOptions(source: SideModuleSource) {
    return {
        name: 'basis',
        script: workerScript(),
        // Each worker gets its own copy: a transferred buffer would leave the next one empty.
        greet: () => ({ message: { init: true, glueText: source.glueText, globalName: source.globalName, wasmBytes: source.wasmBytes.slice(0) } }),
    };
}

/** A transcode job: the bytes (a copy is sent, not the caller's buffer: the loader still holds them for its RGBA fallback). */
type TranscodeJob = { bytes: Uint8Array; code: number; options?: BasisLevelOptions };

/**
 * A transcoder whose work runs on `count` workers, or null where this realm has
 * no workers (mini-game hosts, node) — the caller then transcodes in place.
 *
 * The caller owns the workers: each holds its own instance of the module, and a
 * running worker is never collected, so they last until {@link WorkerBasisTranscoder.dispose}.
 */
export function createWorkerBasisTranscoder(source: SideModuleSource, count: number): WorkerBasisTranscoder | null {
    const o = basisPoolOptions(source);
    const pool = createJobPool(o.script, count, o);
    if (!pool) return null;
    let disposed = false;
    // Least-loaded (affinity -1), so one slow 4K texture does not queue the small ones behind it.
    const run = (job: TranscodeJob): Promise<TranscodeResult | null> => disposed ? Promise.resolve(null)
        : pool.run<TranscodeResult | null>(-1, job).then((r) => r ?? null, (e: unknown) => {
            if (disposed) return null;
            throw new Error(`transcode worker: ${e instanceof Error ? e.message : String(e)}`);
        });
    return {
        transcode: (ktx2, target, options) => run({ bytes: ktx2, code: FORMAT_CODE[target], options }),
        transcodeToRgba: (ktx2, options) => run({ bytes: ktx2, code: RGBA_CODE, options }),
        dispose(): void {
            if (disposed) return;
            disposed = true;
            // Whoever is still waiting is being torn down with the realm: no result, and no error to report.
            pool.dispose();
        },
    };
}

/** Workers to transcode on: the cores beside the main thread, at most four. */
function workerCount(): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 2 : 2;
    return Math.max(1, Math.min(4, cores - 1));
}

/**
 * The realm's KTX2 transcoder: on workers where the host can hand over the
 * module's source and has workers, and on the main thread, a texture per turn of
 * the frame's budget, where it has not (a mini-game) or they failed. Workers
 * that fail once (a CSP refusing blob workers, a module that will not start)
 * send that load and every later one to the main thread.
 *
 * The workers are the host's: they stop when it is disposed, which is what an App
 * does on quit. A realm that starts a game over and over would otherwise keep
 * every earlier game's workers, each with a WebAssembly memory of its own.
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
    const basis = mod as unknown as BasisWasmModule;
    basis._es_basis_init();
    const source = host.source ? await host.source('basis').catch(() => null) : null;
    const jobs = createJobs<TranscodeJob, TranscodeResult | null>({
        ...(source ? basisPoolOptions(source) : { name: 'basis' }),
        size: workerCount(),
        here: (job) => transcodeKtx2Levels(basis, job.bytes, job.code, job.options),
        onLost: (e) => log.warn('asset', 'KTX2 transcoding moved back to the main thread: the transcode workers failed', e),
    });
    let disposed = false;
    host.onDispose?.(() => { disposed = true; jobs.dispose(); });
    const run = (job: TranscodeJob): Promise<TranscodeResult | null> => disposed ? Promise.resolve(null)
        // Torn down mid-load: no result and no error, and no fall back to a module that is going away too.
        : jobs.run(job).then((r) => r ?? null, (e: unknown) => { if (disposed) return null; throw e; });
    return {
        transcode: (ktx2, target, options) => run({ bytes: ktx2, code: FORMAT_CODE[target], options }),
        transcodeToRgba: (ktx2, options) => run({ bytes: ktx2, code: RGBA_CODE, options }),
    };
}
