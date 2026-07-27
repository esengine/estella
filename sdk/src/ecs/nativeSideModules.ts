// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ecs/nativeSideModules.ts
 * @brief   The optional subsystems, as a native host answers them.
 *
 * On the web, physics / spine / the KTX2 transcoder / the video decoder ship as
 * standalone emscripten modules that a realm fetches, inlines or hands over
 * (`SideModuleHost`). A native app has no dynamic-linking story and no reason for
 * one: the same C sources are compiled into the host binary, and their entry points
 * are registered on the JS global object by the generated wrappers.
 *
 * So the "module" here is a VIEW of those globals in the shape the SDK's consumers
 * already expect — `_physics_step(…)` resolves to the host's `es_physics_step` —
 * merged with the heap they marshal buffers through (see nativeHeap.ts). Nothing
 * downstream changes: the runtime's own self-gating installs the physics plugin from
 * `app.sideModules` exactly as it does in a browser.
 *
 * A host that did not compile a subsystem in simply does not answer its entry
 * points, and this reports that as unavailability rather than handing back an object
 * whose first call is a TypeError.
 */

import { createSideModuleHost, type SideModuleHost, type SideModule } from '../sideModules/host';
import { SPINE_VERSIONS, spineModuleId, type SideModuleId } from '../sideModules/registry';
import { log } from '../logger';
import { createNativeHeap, type NativeHeap } from './nativeHeap';

/**
 * One global per subsystem that proves the host compiled it in. Picked from the
 * entry points a consumer calls first, so the probe cannot pass while the surface
 * is half-registered.
 */
// One entry per Spine version the SDK can ask for; which one this host actually
// linked is a second question (see SPINE_VERSION_BINDING), because every vendored
// runtime exports the same symbols and a binary carries exactly one. Derived from
// SPINE_VERSIONS so a newly vendored release cannot be probed for and forgotten.
const SPINE_PROBES = SPINE_VERSIONS.reduce<Partial<Record<SideModuleId, string>>>(
    (probes, version) => {
        probes[spineModuleId(version)] = 'es_spine_loadSkeleton';
        return probes;
    },
    {},
);

export const NATIVE_SIDE_MODULE_PROBES: Partial<Record<SideModuleId, string>> = {
    physics: 'es_physics_init',
    videodec: 'es_video_open',
    ...SPINE_PROBES,
};

/** The host global that reports the linked Spine runtime (38 / 41 / 42 / 43). */
export const SPINE_VERSION_BINDING = 'es_spine_runtimeVersion';

/** The id the host's own Spine runtime answers to, or null if it linked none. */
function nativeSpineId(scope: Record<string, unknown>): SideModuleId | null {
    const report = scope[SPINE_VERSION_BINDING];
    if (typeof report !== 'function') return null;
    const version = (report as () => number)();
    const id = SPINE_VERSIONS.find((v) => v.replace('.', '') === String(version));
    return id ? spineModuleId(id) : null;
}

/** A NUL-terminated UTF-8 string at `ptr` in the heap; empty for a null pointer,
 *  which is what emscripten's UTF8ToString(0) answers. */
function readUtf8(heap: NativeHeap, ptr: number): string {
    if (!ptr) return '';
    let end = ptr;
    while (end < heap.HEAPU8.length && heap.HEAPU8[end] !== 0) end++;
    return new TextDecoder().decode(heap.HEAPU8.subarray(ptr, end));
}

/** Copy `str` into the heap as NUL-terminated UTF-8; the caller frees it. */
function writeUtf8(heap: NativeHeap, str: string): number {
    const bytes = new TextEncoder().encode(str);
    const ptr = heap._malloc(bytes.length + 1);
    if (!ptr) return 0;
    heap.HEAPU8.set(bytes, ptr);
    heap.HEAPU8[ptr + bytes.length] = 0;
    return ptr;
}

/**
 * The host global behind an emscripten C-export name: `_physics_step` →
 * `es_physics_step`. `es_` marks the boundary surface, so a C name that already
 * carries it keeps it (`_es_video_open` → `es_video_open`) — the same rule the
 * generator applies when it registers the wrapper.
 */
function hostGlobal(exportName: string): string {
    const name = exportName.slice(1);
    return name.startsWith('es_') ? name : `es_${name}`;
}

/**
 * A C module's entry points, spelled the way emscripten exports them (`_name`), over
 * the host globals — plus the heap views, since a caller writes its buffers there
 * before passing an offset.
 */
function nativeCModule(scope: Record<string, unknown>, heap: NativeHeap): SideModule {
    const resolved: Record<string, unknown> = {
        ...heap,
        /**
         * emscripten's `cwrap`, as a passthrough. It exists to convert JS strings to
         * C strings and back around a raw export; the generated wrapper already takes
         * and returns JS strings where the declaration says `const char*`, so there is
         * nothing left to convert — the argument types are the caller's statement about
         * a surface that already agrees with them.
         */
        cwrap: (ident: string): unknown => scope[hostGlobal(`_${ident}`)],
        /** The heap's string helpers, in the same terms emscripten states them. */
        UTF8ToString: (ptr: number): string => readUtf8(heap, ptr),
        stringToNewUTF8: (str: string): number => writeUtf8(heap, str),
    };
    return new Proxy(resolved, {
        get(target, prop): unknown {
            if (prop in target) return Reflect.get(target, prop);
            if (typeof prop !== 'string' || !prop.startsWith('_')) return undefined;
            const fn = scope[hostGlobal(prop)];
            if (typeof fn !== 'function') return undefined;
            // Remembered, so repeat calls are a plain property read (and the
            // bridge's per-property guard wrapper keeps working).
            target[prop] = fn;
            return fn;
        },
        has(target, prop): boolean {
            if (prop in target) return true;
            return typeof prop === 'string' && prop.startsWith('_')
                && typeof scope[hostGlobal(prop)] === 'function';
        },
    }) as SideModule;
}

/**
 * The optional-module acquirer for a native host. Answers the subsystems this host
 * compiled in and null for the rest, which is what the runtime's gating already
 * treats as "not available in this realm".
 */
export function createNativeSideModules(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): SideModuleHost {
    const heap = createNativeHeap(scope);
    return createSideModuleHost(async (_descriptor, id): Promise<SideModule> => {
        const probe = NATIVE_SIDE_MODULE_PROBES[id];
        if (!probe) {
            throw new Error(`[native] "${id}" is not compiled into this host`);
        }
        if (typeof scope[probe] !== 'function') {
            throw new Error(
                `[native] "${id}" is not compiled into this host (${probe} is not bound) — `
                + 'rebuild it with that subsystem enabled',
            );
        }
        // A Spine binary is one runtime. Answering the wrong version would load a
        // skeleton with a decoder that cannot read its format, so a project authored
        // against another release is told which one this app carries instead.
        if (id.startsWith('spine:')) {
            const linked = nativeSpineId(scope);
            if (linked !== id) {
                throw new Error(
                    `[native] this app links Spine ${linked ? linked.slice(6) : 'none'}, and the `
                    + `content asks for ${id.slice(6)} — rebuild with `
                    + `-DESTELLA_SPINE_VERSION=${id.slice(6)} (a binary carries one runtime)`,
                );
            }
        }
        if (!heap) {
            throw new Error(
                `[native] "${id}" needs the host heap to marshal buffers, and es_heap is not bound`,
            );
        }
        log.info('sidemodule', `${id}: native (compiled into the host)`);
        return nativeCModule(scope, heap);
    });
}
