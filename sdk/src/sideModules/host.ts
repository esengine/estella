// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
import { log } from '../logger';
import { SIDE_MODULES, type SideModuleDescriptor, type SideModuleId } from './registry';

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
            const descriptor = SIDE_MODULES[id];
            const pending: Promise<SideModule | null> = descriptor
                ? instantiate(descriptor, id).catch((e) => {
                      log.error('sidemodule', `failed to load "${id}" (${descriptor.file})`, e);
                      return null;
                  })
                : Promise.resolve(null);
            cache.set(id, pending);
            return pending;
        },
    };
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
