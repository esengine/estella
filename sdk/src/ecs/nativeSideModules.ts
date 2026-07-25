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
import type { SideModuleId } from '../sideModules/registry';
import { log } from '../logger';
import { createNativeHeap, type NativeHeap } from './nativeHeap';

/**
 * One global per subsystem that proves the host compiled it in. Picked from the
 * entry points a consumer calls first, so the probe cannot pass while the surface
 * is half-registered.
 */
export const NATIVE_SIDE_MODULE_PROBES: Partial<Record<SideModuleId, string>> = {
    physics: 'es_physics_init',
    videodec: 'es_video_open',
};

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
    const resolved: Record<string, unknown> = { ...heap };
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
        if (!heap) {
            throw new Error(
                `[native] "${id}" needs the host heap to marshal buffers, and es_heap is not bound`,
            );
        }
        log.info('sidemodule', `${id}: native (compiled into the host)`);
        return nativeCModule(scope, heap);
    });
}
