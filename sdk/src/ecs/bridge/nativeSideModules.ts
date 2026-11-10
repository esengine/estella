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

import { createSideModuleHost, SideModuleAbsent, type SideModuleHost, type SideModule } from '../../sideModules/host';
import { SPINE_VERSIONS, spineModuleId, type SideModuleId } from '../../sideModules/registry';
import { log } from '../../util/logger';
import { createNativeHeap, type NativeHeap } from './nativeHeap';
// Not TextEncoder/TextDecoder: this file runs inside QuickJS on a device, which
// has neither. See utf8.ts.
import { encodeUtf8, decodeUtf8 } from '../../util/utf8';

/**
 * The prefix a native host binds one Spine release's surface under: `spine38_`
 * for 3.8. Every vendored runtime implements the one `spine_*` surface, and a host
 * carries them all side by side, each renamed (native/CMakeLists.txt), so the
 * release a skeleton was exported from is the one that reads it — as on the web,
 * where each version is a side module of its own.
 */
export function nativeSpinePrefix(version: string): string {
    return `spine${version.replace('.', '')}_`;
}

// One entry per Spine version the SDK can ask for, derived from SPINE_VERSIONS so
// a newly vendored release cannot be probed for and forgotten.
const SPINE_PROBES = Object.fromEntries(SPINE_VERSIONS.map(
    (version) => [spineModuleId(version), `es_${nativeSpinePrefix(version)}loadSkeleton`]));
const SPINE_ALIASES = Object.fromEntries(SPINE_VERSIONS.map(
    (version) => [spineModuleId(version), ['spine_', nativeSpinePrefix(version)] as const]));

/**
 * One global per subsystem that proves the host compiled it in. Picked from the
 * entry points a consumer calls first, so the probe cannot pass while the surface
 * is half-registered.
 */
export const NATIVE_SIDE_MODULE_PROBES: Partial<Record<SideModuleId, string>> = {
    physics: 'es_physics_init',
    physics3d: 'es_physics3d_init',
    // PhysX links beside Jolt, its copy of the same surface renamed (see
    // NATIVE_PREFIX_ALIASES): the probe is that copy's first entry point.
    'physics3d:physx': 'es_physx3d_init',
    videodec: 'es_video_open',
    // One entry, not one per version: the DragonBones format is frozen, so unlike
    // Spine there is no "which runtime did this binary link" question to ask.
    dragonbones: 'es_db_loadSkeleton',
    ...SPINE_PROBES,
};

/**
 * A module whose C surface the host binds under another prefix. PhysX and Jolt
 * implement the one `physics3d_*` surface and share a binary, so the host's build
 * renames PhysX's copy to `physx3d_*` (build-tools/tasks/native.js, PHYSX_ALIAS)
 * and this maps the emscripten names the SDK calls back onto it:
 * `_physics3d_step` → `es_physx3d_step`.
 */
export const NATIVE_PREFIX_ALIASES: Partial<Record<SideModuleId, readonly [from: string, to: string]>> = {
    'physics3d:physx': ['physics3d_', 'physx3d_'],
    ...SPINE_ALIASES,
};

/** A NUL-terminated UTF-8 string at `ptr` in the heap; empty for a null pointer,
 *  which is what emscripten's UTF8ToString(0) answers. */
function readUtf8(heap: NativeHeap, ptr: number): string {
    if (!ptr) return '';
    let end = ptr;
    while (end < heap.HEAPU8.length && heap.HEAPU8[end] !== 0) end++;
    return decodeUtf8(heap.HEAPU8.subarray(ptr, end));
}

/** Copy `str` into the heap as NUL-terminated UTF-8; the caller frees it. */
function writeUtf8(heap: NativeHeap, str: string): number {
    const bytes = encodeUtf8(str);
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
function hostGlobal(exportName: string, alias?: readonly [string, string]): string {
    let name = exportName.slice(1);
    if (alias && name.startsWith(alias[0])) name = alias[1] + name.slice(alias[0].length);
    return name.startsWith('es_') ? name : `es_${name}`;
}

/**
 * A C module's entry points, spelled the way emscripten exports them (`_name`), over
 * the host globals — plus the heap views, since a caller writes its buffers there
 * before passing an offset.
 */
function nativeCModule(
    scope: Record<string, unknown>, heap: NativeHeap, alias?: readonly [string, string],
): SideModule {
    const resolved: Record<string, unknown> = {
        ...heap,
        /**
         * emscripten's `cwrap`, as a passthrough. It exists to convert JS strings to
         * C strings and back around a raw export; the generated wrapper already takes
         * and returns JS strings where the declaration says `const char*`, so there is
         * nothing left to convert — the argument types are the caller's statement about
         * a surface that already agrees with them.
         */
        cwrap: (ident: string): unknown => scope[hostGlobal(`_${ident}`, alias)],
        /** The heap's string helpers, in the same terms emscripten states them. */
        UTF8ToString: (ptr: number): string => readUtf8(heap, ptr),
        stringToNewUTF8: (str: string): number => writeUtf8(heap, str),
    };
    return new Proxy(resolved, {
        get(target, prop): unknown {
            if (prop in target) return Reflect.get(target, prop);
            if (typeof prop !== 'string' || !prop.startsWith('_')) return undefined;
            const fn = scope[hostGlobal(prop, alias)];
            if (typeof fn !== 'function') return undefined;
            // Remembered, so repeat calls are a plain property read (and the
            // bridge's per-property guard wrapper keeps working).
            target[prop] = fn;
            return fn;
        },
        has(target, prop): boolean {
            if (prop in target) return true;
            return typeof prop === 'string' && prop.startsWith('_')
                && typeof scope[hostGlobal(prop, alias)] === 'function';
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
    return createSideModuleHost(async (_descriptor, requested): Promise<SideModule> => {
        let id = requested;
        // A host built without PhysX (macOS and iOS for now, or -DESTELLA_PHYSX=OFF) still
        // links Jolt, which answers the same surface: the project keeps its 3D
        // world, on the other solver, and is told so once rather than losing it.
        if (id === 'physics3d:physx' && typeof scope[NATIVE_SIDE_MODULE_PROBES[id]!] !== 'function'
            && typeof scope[NATIVE_SIDE_MODULE_PROBES.physics3d!] === 'function') {
            log.warn('sidemodule', 'this native host has no PhysX compiled in: the 3D world runs on Jolt, '
                + 'through the same interface, and a solver difference from the web build is expected');
            id = 'physics3d';
        }
        const probe = NATIVE_SIDE_MODULE_PROBES[id];
        if (!probe) {
            throw new SideModuleAbsent(id, 'a native host has no side modules beyond the '
                + 'subsystems it compiles in (KTX2, for one, is decoded in C++)');
        }
        if (typeof scope[probe] !== 'function') {
            // An Android package carries only the Spine releases its skeletons use,
            // and a template from before the host carried them all links one.
            throw new Error(id.startsWith('spine:')
                ? `[native] this app carries no Spine ${id.slice(6)} runtime (${probe} is not bound) — `
                    + 'package it again with this editor version\'s runtime template'
                : `[native] "${id}" is not compiled into this host (${probe} is not bound) — `
                    + 'rebuild it with that subsystem enabled');
        }
        if (!heap) {
            throw new Error(
                `[native] "${id}" needs the host heap to marshal buffers, and es_heap is not bound`,
            );
        }
        log.info('sidemodule', `${id}: native (compiled into the host)`);
        return nativeCModule(scope, heap, NATIVE_PREFIX_ALIASES[id]);
    });
}
