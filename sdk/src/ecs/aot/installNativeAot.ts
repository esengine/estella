// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    installNativeAot.ts
 * @brief   Compiled systems on a host that loads a library, not a wasm module.
 *
 * @details The web road hands the module the engine's memory and packs the rows
 *          here. A native host IS the engine's process: an address is a pointer
 *          nothing in JS can hold, so the host packs them and this says only
 *          which system to run (`es_aot_*`, native/host/bindings/AotBindings.cpp).
 *
 *          What stays on this side is what only this side knows. Where a script
 *          component's rows are, because the pool is ours and it MOVES them; and
 *          the Changed ticks, because compiled code never calls back and the
 *          host has no idea who is watching.
 *
 *          Refuses rather than degrades, exactly as the wasm road does: the
 *          handshake is checked here too, at the width a loading host runs at.
 */

import { getComponent, type AnyComponentDef } from '../component';
import type { World } from '../world';
import type { SystemRunner } from '../system';
import type { Entity } from '../../types';
import { WasmPoolMemory, type WasmHeap } from '../WasmPoolMemory';
import { AotSystems, type AotManifest, type AotTwin } from './AotSystems';
import type { AotDispatcher, AotRuntime } from './AotRuntime';

/** `sizeof(es_addr_t)` where a loaded library runs. */
const NATIVE_ADDRESS_BYTES = 8;

/** The `es_aot_*` surface, as one object so a test can stand in for the host. */
export interface NativeAotBindings {
    install(path: string): number;
    index(name: string): number;
    bound(index: number): boolean;
    scriptRows(name: string, sparseOffset: number, sparseCount: number,
        rowsOffset: number, stride: number, indexMask: number): boolean;
    resource(name: string, offset: number, bytes: number): boolean;
    run(index: number): number;
    reset(): void;
}

export interface InstallNativeAotOptions {
    readonly world: World;
    readonly runner: SystemRunner;
    /** Absolute path to the module the package staged. */
    readonly modulePath: string;
    /** What the build wrote beside it — the names and shapes, checked here. */
    readonly manifest: AotManifest;
    /** The host's linear heap: what a pool allocates from, so an offset means
     *  the same thing on both sides of the boundary. */
    readonly heap: WasmHeap;
    /** The host calls, for a test to stand in for. Absent ⇒ read off globalThis. */
    readonly bindings?: NativeAotBindings;
}

/** The entity index mask a sparse table is addressed by, from the engine's own. */
const ENTITY_INDEX_MASK = 0xfffff;

/** Read the `es_aot_*` globals a native host bound, or null where it bound none. */
export function nativeAotBindings(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): NativeAotBindings | null {
    const fn = (name: string): ((...args: never[]) => unknown) | null =>
        (typeof scope[name] === 'function' ? scope[name] as (...args: never[]) => unknown : null);
    const install = fn('es_aot_install');
    const run = fn('es_aot_run');
    if (install === null || run === null) return null;
    const call = <T>(name: string, fallback: T) => (...args: unknown[]): T => {
        const f = fn(name);
        return f === null ? fallback : (f as (...a: unknown[]) => T)(...args);
    };
    return {
        install: (path) => (install as (p: string) => number)(path),
        index: call<number>('es_aot_index', -1),
        bound: call<boolean>('es_aot_bound', false),
        scriptRows: call<boolean>('es_aot_script_rows', false),
        resource: call<boolean>('es_aot_resource', false),
        run: (index) => (run as (i: number) => number)(index),
        reset: call<void>('es_aot_reset', undefined as void),
    };
}

/**
 * Install a module and hand the runner its twins, or null where this host has
 * no `es_aot_*` at all — which is every host but a native one.
 */
export function installNativeAot(opts: InstallNativeAotOptions): AotRuntime | null {
    const bindings = opts.bindings ?? nativeAotBindings();
    if (bindings === null) return null;

    // Before the first pooled component exists: a pool cannot move to other
    // memory once it has rows, and the host addresses only this heap.
    opts.world.useScriptPoolMemory(new WasmPoolMemory(opts.heap));

    const count = bindings.install(opts.modulePath);
    if (count < 0) return null;

    // Only the ones the host BOUND become twins: the runner calls a twin
    // wherever it finds one, so a twin that dispatches to nothing is a system
    // that never runs at all.
    const byTwin = new Map<string, number>();
    for (const decl of opts.manifest.systems) {
        const at = bindings.index(decl.name);
        if (at >= 0 && bindings.bound(at)) byTwin.set(decl.name, at);
    }
    const running = opts.manifest.systems.filter((decl) => byTwin.has(decl.name));

    // The handshake at the loading width, over the WHOLE manifest — that is
    // what the module is. The exports throw because the host holds the function
    // pointers here, so a twin's `call` reaching one is a bug, loudly.
    const systems = new AotSystems();
    const exports: Record<string, unknown> = {};
    for (const decl of opts.manifest.systems) {
        exports[decl.symbol] = () => {
            throw new Error(`AOT: ${decl.name} is the host's to call, not this runtime's`);
        };
    }
    systems.install(opts.manifest, exports, (name) => getComponent(name),
        () => [], NATIVE_ADDRESS_BYTES, (name) => byTwin.has(name));

    // Every script component any running twin names, so one epoch change
    // re-reports all of them rather than whichever twin happened to run first.
    const pooled = new Set<string>();
    for (const decl of running) {
        for (const query of decl.queries) for (const arg of query) pooled.add(arg.comp);
    }

    const runtime: AotRuntime = {
        systems,
        // Absent on this road: nothing here resolves an address, because nothing
        // here can hold one. Present in the type so the wasm road cannot omit it.
        addresses: {
            componentNamed: (name: string) => getComponent(name),
            resourceAt: () => undefined,
        } as unknown as AotRuntime['addresses'],
        ctx: null as unknown as AotRuntime['ctx'],
        dispatcherFor: (world) => new NativeAotDispatch(world, bindings, byTwin, pooled),
    };
    opts.runner.useAot(runtime);
    return runtime;
}

/**
 * One twin's frame on a host that packs its own rows.
 *
 * Two things happen here and nothing else: the pools are re-reported when they
 * may have moved, and the Changed ticks are marked. The call itself is one
 * number crossing the boundary.
 */
class NativeAotDispatch implements AotDispatcher {
    /** The epoch the pools were last reported at. Null means never. */
    private reportedAt_: number | null | undefined = undefined;

    constructor(
        private readonly world: World,
        private readonly bindings: NativeAotBindings,
        private readonly indexByName: ReadonlyMap<string, number>,
        private readonly pooled: ReadonlySet<string>,
    ) {}

    run(twin: AotTwin): void {
        // Every twin that exists is one the host bound; install made sure of it.
        const at = this.indexByName.get(twin.decl.name)!;
        this.reportPools_();
        this.bindings.run(at);
        this.markChanged_(twin);
    }

    /**
     * Tell the host where each script component's rows are NOW.
     *
     * Keyed on the layout epoch, which is what the engine and the pools both
     * bump when anything moved. Null means nobody could say, and then the answer
     * has to be "assume they moved" — the same rule the row cache follows.
     */
    private reportPools_(): void {
        const epoch = this.world.layoutEpoch();
        if (epoch !== null && epoch === this.reportedAt_) return;
        this.reportedAt_ = epoch;
        for (const name of this.pooled) {
            const def = getComponent(name);
            const span = def === undefined ? undefined : this.world.scriptSpanOf(def);
            if (span === undefined) continue;
            this.bindings.scriptRows(name, span.sparse, span.sparseCount,
                span.rows, span.stride, ENTITY_INDEX_MASK);
        }
    }

    /**
     * The ticks the compiled code could not leave. The matched set is walked
     * here rather than carried back: it is the same set — every component
     * present — and a query is cheaper than marshalling the rows. Only when
     * something watches, because that walk is the whole cost.
     */
    private markChanged_(twin: AotTwin): void {
        for (let k = 0; k < twin.decl.queries.length; k++) {
            const mutated = (twin.mutated[k] ?? []).filter((def) => this.world.isChangeTracked(def));
            if (mutated.length === 0) continue;
            const comps = twin.decl.queries[k]!
                .map((arg) => getComponent(arg.comp))
                .filter((def): def is AnyComponentDef => def !== undefined);
            for (const entity of this.world.queryEntities(comps)) {
                for (const def of mutated) this.world.markChanged(entity as Entity, def);
            }
        }
    }
}
