// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    installAot.ts
 * @brief   Take a built module and let the scheduler call it.
 *
 * @details The one entry point a shipping runtime needs: instantiate the wasm a
 *          build produced, check what it baked in, and hand the runner the twins.
 *          Everything it assembles has been tested on its own — this is the
 *          wiring that was waiting for the handshake to be decided.
 *
 *          The module IMPORTS the engine's memory, so there is nothing to link
 *          and no engine change: it reads the components where they already
 *          are.
 *
 *          Refuses rather than degrades. A module built for other offsets does
 *          not produce a wrong answer, it produces a read of a different field,
 *          and a runtime that fell back to the interpreter on a mismatch would
 *          hide exactly the thing worth knowing.
 */

import { platformInstantiateWasm } from '../../platform';
import { getComponent } from '../component';
import type { AnyComponentDef } from '../component';
import type { World } from '../world';
import type { SystemRunner } from '../system';
import type { Entity } from '../../types';
import { WasmPoolMemory, type WasmHeap } from '../WasmPoolMemory';
import { AotContext } from './AotContext';
import { AotResources, type ResourceReader } from './AotResources';
import { AotEvents, type EventBusAccess } from './AotEvents';
import { AotSystems, type AotManifest } from './AotSystems';
import type { AotAddresses, AotRuntime } from './AotRuntime';
import { AotDispatch } from './AotDispatch';
import { missingCapabilities, whyInterpreted, WEB_AOT } from './executorCapabilities';
import { log } from '../../util/logger';

/**
 * The engine module a compiled system shares memory with. The Memory OBJECT,
 * which the module imports as `env.memory`: a HEAP view's buffer is an
 * ArrayBuffer and cannot be imported.
 */
export type AotHost = WasmHeap & { readonly memory: WebAssembly.Memory };

export interface InstallAotOptions {
    readonly world: World;
    readonly runner: SystemRunner;
    /** The engine's wasm module: its memory is the one the systems read. */
    readonly host: AotHost;
    /** What the build wrote beside the module. */
    readonly manifest: AotManifest;
    /** The module: a package-relative path, or its bytes. A path is the only
     *  form WeChat takes (WXWebAssembly cannot compile a buffer), so the
     *  platform seam is what instantiates rather than this. */
    readonly wasm: string | BufferSource;
    /** The live value of a named resource, for the mirror to copy in. */
    readonly resources: ResourceReader;
    /**
     * The fields this runtime's `name` has, in its own order, or undefined when
     * there is no such resource. Two questions at once, and both are asked at
     * install: whether it exists, and whether it still looks the way the module
     * was built against.
     */
    readonly resourceFields?: (name: string) => readonly string[] | undefined;
    /** The bus a manifest's event NAME refers to, for reading and for sending. */
    readonly events?: EventBusAccess;
}

/**
 * Install the twins. Throws if the module disagrees with this engine or this
 * project, and the message says which. Call it BEFORE the world has any pooled
 * component: the rows must be in the memory the module reads, and moving them
 * afterwards would leave half of them behind — so it refuses instead.
 */
export async function installAot(opts: InstallAotOptions): Promise<AotRuntime> {
    const runtime = await prepareAot(opts);
    opts.runner.useAot(runtime);
    return runtime;
}

/**
 * Everything install does except hand the twins to a runner, because the two
 * halves have different deadlines: the pool memory has to be in place before the
 * world's first pooled component, and a runner may not exist until the first
 * frame. A caller holding the result attaches it when it does.
 */
/**
 * What the module says it was built as. Two exported functions rather than a
 * constant: a module sharing the engine's memory carries no data section.
 */
function moduleContractOf(exports: Readonly<Record<string, unknown>>): string | null {
    const lo = exports['es_module_contract_lo'];
    const hi = exports['es_module_contract_hi'];
    if (typeof lo !== 'function' || typeof hi !== 'function') return null;
    const half = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
    return half((hi as () => number)()) + half((lo as () => number)());
}

export async function prepareAot(opts: Omit<InstallAotOptions, 'runner'>): Promise<AotRuntime> {
    const memory = new WasmPoolMemory(opts.host);
    opts.world.useScriptPoolMemory(memory);

    const { instance } = await platformInstantiateWasm(
        wasmSource(opts.wasm), { env: { memory: opts.host.memory } });
    const exports = instance.exports as unknown as Record<string, unknown>;
    // A STANDALONE_WASM reactor runs its data setup here rather than at an entry
    // point, and the module has none.
    (exports['_initialize'] as (() => void) | undefined)?.();

    const systems = new AotSystems();
    // Through the same question the loading road asks, though this road answers
    // yes to all of it: a road that does not DECLARE what it carries is a road
    // outside the model, and the next capability to differ would find no gate.
    const takeable = new Map(opts.manifest.systems.map((decl) => {
        const missing = missingCapabilities(decl, WEB_AOT);
        if (missing.length > 0) log.info('runtime', whyInterpreted(decl.name, missing));
        return [decl.name, missing.length === 0];
    }));
    systems.install(opts.manifest, exports, componentNamed, {
        resourceFields: opts.resourceFields ?? ((name) => {
            const value = opts.resources(name);
            return value === undefined ? undefined : Object.keys(value);
        }),
        runs: (name) => takeable.get(name) ?? false,
        moduleContract: moduleContractOf(exports),
    });

    const runtime: AotRuntime = {
        systems,
        addresses: worldAddresses(
            new AotResources(memory, opts.resources, declaredLayouts(opts.manifest)),
            new AotEvents(memory, opts.events ?? (() => undefined))),
        ctx: new AotContext(memory),
        // This module shares the engine's memory, so the rows go there and the
        // call takes their address.
        dispatcherFor: (world) => new AotDispatch(world, runtime),
    };
    return runtime;
}

/**
 * The module as the platform seam takes it. A view over a pooled buffer (what
 * node hands back for a file read) is a window onto other bytes, so it gives up
 * its own rather than the pool's.
 */
function wasmSource(wasm: string | BufferSource): string | ArrayBuffer {
    if (typeof wasm === 'string' || wasm instanceof ArrayBuffer) return wasm;
    return wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer;
}

/** Layouts the BUILD derived for the project's own resources, by name. */
function declaredLayouts(manifest: AotManifest): Map<string, readonly string[]> {
    const out = new Map<string, readonly string[]>();
    for (const decl of manifest.systems) {
        for (const r of decl.resources) if (r.fields) out.set(r.name, r.fields);
    }
    return out;
}

/** What a manifest's component NAME means in this runtime. */
function componentNamed(name: string): AnyComponentDef | undefined {
    return getComponent(name);
}

/**
 * What the manifest's names mean here, and where a resource's mirror is. A
 * COMPONENT's address is not among them: `AotDispatch` takes a resolver from the
 * world once per system rather than asking per row.
 */
export function worldAddresses(resources: AotResources, payloads: AotEvents): AotAddresses {
    return {
        componentNamed,
        resourceAt: (name: string) => resources.addressOf(name),
        resourceWriteBack: (name: string) => resources.writeBack(name),
        payloadRows: (event, fields) => payloads.rowsFor(event, fields),
        sendEvent: (event, fields, values) => payloads.send(event, fields, values),
        releasePayloads: () => payloads.release(),
    };
}
