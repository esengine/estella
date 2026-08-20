// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    host.ts
 * @brief   The realm-agnostic acquirer for optional native modules.
 *
 * @details One {@link SideModuleHost} per realm answers "give me module X for
 *          this realm", caching the result so repeat callers (e.g. several spine
 *          entities of the same version) share one instance. The host is pure
 *          orchestration: id → descriptor lookup + cache. The realm supplies the
 *          *transport* as an {@link SideModuleInstantiator}; the fetch / embedded
 *          / WeChat transports live in sibling files.
 */
import { log } from '../util/logger';
import { SIDE_MODULES, sideModuleDescriptor, type SideModuleDescriptor, type SideModuleId } from './registry';

/** The instantiated emscripten module. Consumers cwrap their own `_*` exports. */
export type SideModule = Record<string, unknown>;

/** Realm-agnostic acquirer for optional native modules. */
export interface SideModuleHost {
    /** Instantiate `id` for this realm (cached); null if unavailable or it failed. */
    acquire(id: SideModuleId): Promise<SideModule | null>;
}

/** A realm's transport: turn a descriptor into an instantiated module. */
export type SideModuleInstantiator = (descriptor: SideModuleDescriptor, id: SideModuleId) => Promise<SideModule>;

/**
 * Thrown by a transport for a module its realm was never built to carry, rather
 * than one that should be there and would not load. A native host decodes KTX2 in
 * C++ and so has no `basis` to give — reported as a failure, that made every game
 * with a Spine atlas read as a broken boot.
 */
export class SideModuleAbsent extends Error {
    constructor(id: SideModuleId, why: string) {
        super(`"${id}" is not part of this realm — ${why}`);
        this.name = 'SideModuleAbsent';
    }
}

/**
 * Build a host over a transport. Caches per id (including failures-as-null so a
 * missing artifact isn't refetched every frame). The transport is the only
 * realm-specific part; everything above it — gating, plugin install — is shared.
 */
export function createSideModuleHost(instantiate: SideModuleInstantiator): SideModuleHost {
    const cache = new Map<SideModuleId, Promise<SideModule | null>>();
    return {
        acquire(id: SideModuleId): Promise<SideModule | null> {
            const cached = cache.get(id);
            if (cached) return cached;
            const descriptor = sideModuleDescriptor(id);
            const pending: Promise<SideModule | null> = descriptor
                ? instantiate(descriptor, id).catch((e: unknown) => {
                      // Absent BY DESIGN is the answer null already means; only a
                      // module that was meant to be here is a failure to report.
                      if (e instanceof SideModuleAbsent) log.info('sidemodule', e.message);
                      else log.error('sidemodule', `failed to load "${id}" (${descriptor.file}) — ${howToFix(id)}`, e);
                      return null;
                  })
                // Unknown ids used to be impossible (the type was closed) and so
                // returned null in silence. Now that a project can name its own,
                // silence is how a typo becomes "this runtime just doesn't work".
                : (log.warn('sidemodule', `no module named "${id}" is registered — a built-in id, or one `
                    + 'declared in .esengine/modules/<id>/module.json and picked up by the export'),
                   Promise.resolve(null));
            cache.set(id, pending);
            return pending;
        },
    };
}

/**
 * What to do about a module that would not load, which differs by who built it.
 *
 * For an engine module a 404 is almost always a missing local build artifact, so
 * the advice is the build command. For a project's own module the engine has no
 * idea how it is produced — pointing someone at `pnpm build -t rive` would be a
 * command that does not exist — so it says where the export looked instead.
 */
function howToFix(id: SideModuleId): string {
    if (id in SIDE_MODULES) {
        return 'likely not built locally: run the matching wasm build (spine 4.2 = '
            + '`pnpm build -t spine`, others match their file name, `-t all` builds '
            + 'everything), then rebuild the editor';
    }
    return `this is a project module: check that .esengine/modules/${id}/ carries a build for `
        + 'this platform, and that the export staged it';
}

/** A factory produced by an emscripten `MODULARIZE` glue. */
export type EmscriptenFactory = (opts: Record<string, unknown>) => Promise<SideModule>;

/**
 * Run an emscripten module factory, handing it the wasm bytes through
 * `instantiateWasm` so the glue never fetches anything itself (the byte source
 * is the realm's concern, already resolved by the caller). emscripten's
 * `instantiateWasm` has no failure channel — a failed async instantiation just
 * never calls back and the factory promise hangs forever — so we race it against
 * a reject gate and surface the error instead.
 */
export function instantiateWithBytes(
    factory: EmscriptenFactory,
    wasmBytes: ArrayBuffer,
    extraOpts: Record<string, unknown> = {},
): Promise<SideModule> {
    let rejectOnError: (e: unknown) => void = () => {};
    const errorGate = new Promise<never>((_, reject) => {
        rejectOnError = reject;
    });
    const opts: Record<string, unknown> = {
        ...extraOpts,
        instantiateWasm(imports: WebAssembly.Imports, cb: (inst: WebAssembly.Instance, mod?: WebAssembly.Module) => void) {
            WebAssembly.instantiate(wasmBytes, imports).then(
                (r) => cb(r.instance, r.module),
                (e) => rejectOnError(e),
            );
            return {};
        },
    };
    return Promise.race([factory(opts), errorGate]);
}

/**
 * Resolve the module factory out of emscripten glue *text* and instantiate it
 * with `wasmBytes`. Browser realms (fetch + embedded) share this: the glue is
 * run as an ES module via a blob URL (its own scope, no global leakage). A glue
 * with `EXPORT_ES6` exposes the factory as `default`; a `MODULARIZE` glue with a
 * named `EXPORT_NAME` (spine) leaves it module-scoped, so the descriptor's
 * `globalName` tells us to hoist it onto `globalThis` for one tick to retrieve it.
 */
export async function instantiateFromGlueText(
    glueText: string,
    wasmBytes: ArrayBuffer,
    descriptor: SideModuleDescriptor,
): Promise<SideModule> {
    const factory = await resolveFactory(glueText, descriptor);
    if (typeof factory !== 'function') {
        throw new Error(`side module "${descriptor.file}": glue exposed no factory`);
    }
    return instantiateWithBytes(factory as EmscriptenFactory, wasmBytes);
}

const HOIST_KEY = '__es_side_module_factory__';

async function resolveFactory(glueText: string, descriptor: SideModuleDescriptor): Promise<unknown> {
    const g = globalThis as Record<string, unknown>;
    const source = descriptor.globalName
        ? `${glueText};globalThis[${JSON.stringify(HOIST_KEY)}]=${descriptor.globalName};`
        : glueText;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
        const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ url)) as { default?: unknown };
        if (descriptor.globalName) {
            const factory = g[HOIST_KEY];
            delete g[HOIST_KEY];
            return factory;
        }
        return mod.default;
    } finally {
        URL.revokeObjectURL(url);
    }
}
