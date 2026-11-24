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

import { getComponent, isBuiltinComponent, type AnyComponentDef } from '../component';
import { log } from '../../util/logger';
import { type World, feedsTransformComposition } from '../world';
import type { SystemRunner } from '../system';
import { ENTITY_INDEX_MASK, type Entity } from '../../types';
import { WasmPoolMemory, type WasmHeap } from '../WasmPoolMemory';
import { AotSystems, type AotManifest, type AotTwin } from './AotSystems';
import { AotResources, declaredResourceLayouts, resourceFieldNames, type ResourceReader } from './AotResources';
import type { AotDispatcher, AotRuntime } from './AotRuntime';
import { missingCapabilities, whyInterpreted, NATIVE_AOT } from './executorCapabilities';
import { disposeAll } from '../../util/disposeAll';

/** `sizeof(es_addr_t)` where a loaded library runs. */
const NATIVE_ADDRESS_BYTES = 8;

/** The `es_aot_*` surface, as one object so a test can stand in for the host. */
export interface NativeAotBindings {
    /** Shared native dispatcher ownership across freshly created wrappers. */
    readonly runtimeIdentity?: object;
    install(path: string): number;
    /** Candidate contract validation before the live module is replaced. */
    installChecked?(path: string, expectedContract: string): number;
    index(name: string): number;
    bound(index: number): boolean;
    scriptRows(name: string, sparseOffset: number, sparseCount: number,
        rowsOffset: number, stride: number, indexMask: number,
        ownersOffset: number, ownerCount: number): boolean;
    resource(name: string, offset: number, bytes: number): boolean;
    run(index: number, scriptEpoch: number): number;
    reset(): void;
    /** Which BUILD the module is, or '' where the host cannot say — an older
     *  runtime template, which is unpaired and not paired. */
    contract?(): string;
}

const nativeOwners = new WeakMap<object, { retire(): void }>();

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
    /** This world's resource values, for the mirror a call reads them from. */
    readonly resources?: ResourceReader;
    /** The host calls, for a test to stand in for. Absent ⇒ read off globalThis. */
    readonly bindings?: NativeAotBindings;
}

/**
 * The mask a sparse table is addressed by — the SDK's own, imported rather than
 * spelled again. It was spelled again here, as a 20-bit mask against the real
 * 22-bit one, which aliased every entity above index 2^20 onto another row.
 */
const SPARSE_INDEX_MASK = ENTITY_INDEX_MASK;


/** Read the `es_aot_*` globals a native host bound, or null where it bound none. */
export function nativeAotBindings(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): NativeAotBindings | null {
    const fn = (name: string): ((...args: never[]) => unknown) | null =>
        (typeof scope[name] === 'function' ? scope[name] as (...args: never[]) => unknown : null);
    const install = fn('es_aot_install');
    const checked = fn('es_aot_install_checked');
    const run = fn('es_aot_run');
    if (install === null || run === null) return null;
    const call = <T>(name: string, fallback: T) => (...args: unknown[]): T => {
        const f = fn(name);
        return f === null ? fallback : (f as (...a: unknown[]) => T)(...args);
    };
    return {
        runtimeIdentity: install,
        install: (path) => (install as (p: string) => number)(path),
        ...(checked === null ? {} : { installChecked: (path: string, expected: string) =>
            (checked as (p: string, e: string) => number)(path, expected) }),
        index: call<number>('es_aot_index', -1),
        bound: call<boolean>('es_aot_bound', false),
        scriptRows: call<boolean>('es_aot_script_rows', false),
        resource: call<boolean>('es_aot_resource', false),
        run: (index, scriptEpoch) =>
            (run as (i: number, e: number) => number)(index, scriptEpoch),
        reset: call<void>('es_aot_reset', undefined as void),
        contract: call<string>('es_aot_contract', ''),
    };
}

/**
 * Install a module and hand the runner its twins, or null where this host has
 * no `es_aot_*` at all — which is every host but a native one.
 */
export function installNativeAot(opts: InstallNativeAotOptions): AotRuntime | null {
    const installedRegistry = opts.world.getCppRegistry();
    const installedModule = opts.world.getWasmModule();
    const bindings = opts.bindings ?? nativeAotBindings();
    if (bindings === null) return null;

    const systems = new AotSystems();
    const exports: Record<string, unknown> = {};
    for (const decl of opts.manifest.systems) {
        exports[decl.symbol] = () => {
            throw new Error(`AOT: ${decl.name} is the host's to call, not this runtime's`);
        };
    }
    const resourceFields = (name: string) => resourceFieldNames(opts.resources?.(name));
    // Reject runtime shape/ABI mismatches before the host changes its module.
    systems.install(opts.manifest, exports, getComponent, {
        addressBytes: NATIVE_ADDRESS_BYTES, runs: () => false, resourceFields,
    });

    // Before the first pooled component exists: a pool cannot move to other
    // memory once it has rows, and the host addresses only this heap.
    const memory = new WasmPoolMemory(opts.heap);
    opts.world.useScriptPoolMemory(memory, true);

    const count = bindings.installChecked
        ? bindings.installChecked(opts.modulePath, opts.manifest.moduleContract ?? '')
        : bindings.install(opts.modulePath);
    if (count < 0) return null;

    const identity = bindings.runtimeIdentity ?? bindings;
    const previous = nativeOwners.get(identity);
    const lease = { retire: () => {} };
    nativeOwners.set(identity, lease);
    const ownsHost = () => nativeOwners.get(identity) === lease;
    try { previous?.retire(); }
    catch (error) { log.warn('runtime', 'Native compiled runtime retirement error', error); }

    try {
        opts.world.useScriptPoolMemory(memory);

        // The index the scheduler keeps. Whether the host can BIND one is settled at
        // the first run instead: a script pool does not exist until an entity has
        // that component, and until then the interpreter keeps the system.
        const byName = new Map<string, number>();
        for (const decl of opts.manifest.systems) {
            const missing = missingCapabilities(decl, NATIVE_AOT);
            if (missing.length > 0) {
                log.info('runtime', whyInterpreted(decl.name, missing));
                continue;
            }
            const at = bindings.index(decl.name);
            if (at >= 0) byName.set(decl.name, at);
        }

        // The handshake at the loading width, over the WHOLE manifest — that is
        // what the module is. The exports throw because the host holds the function
        // pointers here, so a twin's `call` reaching one is a bug, loudly.
        // The artifact is the host's to read here, so the pairing comes back from
        // it rather than off an export this side can reach.
        const paired = bindings.contract?.() ?? '';
        systems.install(opts.manifest, exports, (name) => getComponent(name), {
            addressBytes: NATIVE_ADDRESS_BYTES,
            runs: (name) => byName.has(name),
            moduleContract: paired === '' ? null : paired,
            // From the RUNTIME's own copy. The default answers "no fields" for every
            // resource, so this road's handshake could not see a project resource at
            // all and the mirror was laid out from the manifest alone.
            resourceFields,
        });

        // Every script component any twin names, so one epoch change re-reports all
        // of them rather than whichever twin happened to run first.
        const pooled = new Set<string>();
        for (const decl of opts.manifest.systems) {
            for (const query of decl.queries) for (const arg of query) pooled.add(arg.comp);
        }
        // The resources, mirrored into the same heap the pools use. A resource has no
        // address of its own until something writes one down, and doing that per call
        // is what the contract promises — the address is good for one call.
        const resources = new AotResources(memory, opts.resources ?? (() => undefined),
            declaredResourceLayouts(opts.manifest));

        let disposed = false;
        const runtime: AotRuntime = {
            dispose() {
                if (disposed) return;
                disposed = true;
                systems.clear();
                const current = ownsHost();
                if (current) nativeOwners.delete(identity);
                disposeAll([() => { if (current) bindings.reset(); }, () => resources.dispose()], action => action());
            },
            systems,
            // Absent on this road: nothing here resolves an address, because nothing
            // here can hold one. Present in the type so the wasm road cannot omit it.
            addresses: {
                componentNamed: (name: string) => getComponent(name),
                resourceAt: () => undefined,
            } as unknown as AotRuntime['addresses'],
            ctx: null as unknown as AotRuntime['ctx'],
            dispatcherFor: (world) => {
                const dispatch = new NativeAotDispatch(world, bindings, byName, pooled, resources, systems);
                // The host's run(index, epoch) always addresses the registry it installed against.
                return { run: twin => !disposed && world.getCppRegistry() === installedRegistry
                    && world.getWasmModule() === installedModule && dispatch.run(twin) };
            },
        };
        lease.retire = () => runtime.dispose?.();
        if (!ownsHost()) {
            runtime.dispose?.();
            throw new Error('Native compiled installation was superseded during preparation');
        }
        opts.runner.useAot(runtime);
        return runtime;
    } catch (error) {
        try { lease.retire(); } catch (releaseError) { log.warn('runtime', 'Native compiled cleanup error', releaseError); }
        if (ownsHost()) {
            nativeOwners.delete(identity);
            try { bindings.reset(); } catch (resetError) { log.warn('runtime', 'Native compiled reset error', resetError); }
        }
        throw error;
    }
}

/**
 * One twin's frame on a host that packs its own rows.
 *
 * Two things happen here and nothing else: the pools are re-reported when they
 * may have moved, and the Changed ticks are marked. The call itself is one
 * number crossing the boundary.
 */
class NativeAotDispatch implements AotDispatcher {
    private lifetime_: symbol | undefined;
    /** The epoch the pools were last reported at. Null means never. */
    private reportedAt_: number | null | undefined = undefined;
    /** Systems the host has taken at least once, so it is said once. */
    private readonly running_ = new Set<string>();
    private readonly assetQueries_ = new Map<AotTwin, {
        comps: AnyComponentDef[];
        scripts: AnyComponentDef[];
        addresses: ((entity: Entity) => number | undefined)[];
    }[]>();

    constructor(
        private readonly world: World,
        private readonly bindings: NativeAotBindings,
        private readonly indexByName: ReadonlyMap<string, number>,
        private readonly pooled: ReadonlySet<string>,
        private readonly resources: AotResources,
        private readonly systems: AotSystems,
    ) {}

    run(twin: AotTwin): boolean {
        const at = this.indexByName.get(twin.decl.name);
        if (at === undefined) return false;
        const lifetime = this.world.entityLifetime;
        if (this.lifetime_ !== lifetime) {
            this.lifetime_ = lifetime;
            this.reportedAt_ = undefined;
            this.assetQueries_.clear();
        }
        // Mirroring a resource can run project code. Publish component spans
        // and check whether rows are addressable after those callbacks return.
        if (!this.reportResources_(twin, lifetime)) return this.world.entityLifetime !== lifetime;
        if (this.world.entityLifetime !== lifetime) return true;
        // A portable reference lives beside its numeric pool until resolved.
        // The host only sees numeric memory, so never let it run a partial
        // query while the interpreter can still see the authored string.
        let queries = this.assetQueries_.get(twin);
        if (!queries) {
            queries = twin.decl.queries.map(query => {
                const comps = query.map(arg => getComponent(arg.comp))
                    .filter((def): def is AnyComponentDef => def !== undefined);
                const scripts = comps.filter(def => !isBuiltinComponent(def));
                return { comps, scripts, addresses: scripts.map(def => this.world.addressResolver(def)) };
            });
            this.assetQueries_.set(twin, queries);
        }
        for (const query of queries) {
            if (!query.scripts.some(def => this.world.hasPortableScriptAssetRefs(def))) continue;
            for (const entity of this.world.queryEntities(query.comps)) {
                for (let i = 0; i < query.scripts.length; i++) {
                    if (query.addresses[i](entity) === undefined) return false;
                }
            }
        }
        this.reportPools_(lifetime);
        if (this.world.entityLifetime !== lifetime) return true;
        // The epoch goes with the call: the host keeps last frame's row table
        // when nothing moved, and only this side can say whether a script pool
        // gained or lost a row.
        //
        // Negative means the host still cannot name everything this system
        // reads — a pool with no rows yet, a resource nothing has written.
        // The interpreter keeps it this frame and it is asked again next.
        if (this.bindings.run(at, this.world.scriptLayoutEpoch()) < 0) return this.world.entityLifetime !== lifetime;
        // The counter `App.compiledSystems` reports to say installed is not RAN.
        // It was web-only, so on the road whose fallback is by design the
        // instrument for spotting one answered 0 every frame.
        this.systems.noteCall();
        // Once, the first time the host takes it. "Installed" says a module
        // loaded; this says a system is actually running as machine code, and
        // the two are different frames when a pool has to exist first.
        if (!this.running_.has(twin.decl.name)) {
            this.running_.add(twin.decl.name);
            log.info('runtime', `AOT: ${twin.decl.name} is running compiled`);
        }
        this.writeBackResources_(twin, lifetime);
        if (this.world.entityLifetime === lifetime) this.markChanged_(twin, lifetime);
        return true;
    }

    /** Mirror each declared resource into the heap and say where it landed. */
    private reportResources_(twin: AotTwin, lifetime: symbol): boolean {
        for (const res of twin.decl.resources) {
            if (this.world.entityLifetime !== lifetime) return false;
            const at = this.resources.addressOf(res.name);
            if (!at || this.world.entityLifetime !== lifetime) return false;
            if (!this.bindings.resource(res.name, at, this.resources.bytesOf(res.name))) return false;
        }
        return true;
    }

    /** A `ResMut` the compiled code wrote is in the mirror, not in the world. */
    private writeBackResources_(twin: AotTwin, lifetime: symbol): void {
        for (const res of twin.decl.resources) {
            if (this.world.entityLifetime !== lifetime) return;
            if (res.mut) this.resources.writeBack(res.name);
        }
    }

    /**
     * Tell the host where each script component's rows are NOW.
     *
     * Keyed on the layout epoch, which is what the engine and the pools both
     * bump when anything moved. Null means nobody could say, and then the answer
     * has to be "assume they moved" — the same rule the row cache follows.
     */
    private reportPools_(lifetime: symbol): void {
        const epoch = this.world.layoutEpoch();
        if (epoch !== null && epoch === this.reportedAt_) return;
        this.reportedAt_ = epoch;
        for (const name of this.pooled) {
            if (this.world.entityLifetime !== lifetime) return;
            const def = getComponent(name);
            if (def === undefined || isBuiltinComponent(def)) continue;
            const span = this.world.scriptSpanOf(def);
            if (span === undefined) {
                this.bindings.scriptRows(name, 0, 0, 0, 0, SPARSE_INDEX_MASK, 0, 0);
                continue;
            }
            this.bindings.scriptRows(name, span.sparse, span.sparseCount,
                span.rows, span.stride, SPARSE_INDEX_MASK, span.owners, span.ownerCount);
        }
    }

    /**
     * The ticks the compiled code could not leave. The matched set is walked
     * here rather than carried back: it is the same set — every component
     * present — and a query is cheaper than marshalling the rows. Only when
     * something watches, because that walk is the whole cost.
     */
    private markChanged_(twin: AotTwin, lifetime: symbol): void {
        for (let k = 0; k < twin.decl.queries.length; k++) {
            // Before the tracking filter below: composition staleness is not an
            // observation and must not inherit its opt-in.
            for (const def of twin.mutated[k] ?? []) {
                if (feedsTransformComposition(def)) {
                    this.world.invalidateTransformComposition();
                    break;
                }
            }
            const mutated = (twin.mutated[k] ?? []).filter((def) => this.world.isChangeTracked(def));
            if (mutated.length === 0) continue;
            const comps = twin.decl.queries[k]!
                .map((arg) => getComponent(arg.comp))
                .filter((def): def is AnyComponentDef => def !== undefined);
            for (const entity of this.world.queryEntities(comps)) {
                for (const def of mutated) {
                    this.world.markChanged(entity as Entity, def);
                    if (def.assetFields?.length && this.world.entityLifetime !== lifetime) return;
                }
            }
        }
    }
}
