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
 *          and no engine change: it reads the components where they already are
 *          (docs/REARCH_AOT.md §6.1).
 *
 *          Refuses rather than degrades. A module built for other offsets does
 *          not produce a wrong answer, it produces a read of a different field,
 *          and a runtime that fell back to the interpreter on a mismatch would
 *          hide exactly the thing worth knowing.
 */

import { getComponent } from '../component';
import type { AnyComponentDef } from '../component';
import type { World } from '../world';
import type { SystemRunner } from '../system';
import type { Entity } from '../../types';
import { WasmPoolMemory, type WasmHeap } from '../WasmPoolMemory';
import { AotContext } from './AotContext';
import { AotResources, type ResourceReader } from './AotResources';
import { AotSystems, type AotManifest } from './AotSystems';
import type { AotAddresses, AotRuntime } from './AotRuntime';

/** The engine module a compiled system shares memory with. */
export type AotHost = WasmHeap & { readonly memory: WebAssembly.Memory };

export interface InstallAotOptions {
    readonly world: World;
    readonly runner: SystemRunner;
    /** The engine's wasm module: its memory is the one the systems read. */
    readonly host: AotHost;
    /** What the build wrote beside the module. */
    readonly manifest: AotManifest;
    readonly wasm: BufferSource;
    /** The live value of a named resource, for the mirror to copy in. */
    readonly resources: ResourceReader;
}

/**
 * Install the twins. Throws if the module disagrees with this engine or this
 * project, and the message says which. Call it BEFORE the world has any pooled
 * component: the rows must be in the memory the module reads, and moving them
 * afterwards would leave half of them behind — so it refuses instead.
 */
export async function installAot(opts: InstallAotOptions): Promise<AotRuntime> {
    const memory = new WasmPoolMemory(opts.host);
    opts.world.useScriptPoolMemory(memory);

    const instance = await WebAssembly.instantiate(
        new WebAssembly.Module(opts.wasm), { env: { memory: opts.host.memory } });
    const exports = instance.exports as unknown as Record<string, unknown>;
    // A STANDALONE_WASM reactor runs its data setup here rather than at an entry
    // point, and the module has none.
    (exports['_initialize'] as (() => void) | undefined)?.();

    const systems = new AotSystems();
    systems.install(opts.manifest, exports, componentNamed);

    const runtime: AotRuntime = {
        systems,
        addresses: worldAddresses(opts.world, new AotResources(memory, opts.resources)),
        ctx: new AotContext(memory),
    };
    opts.runner.useAot(runtime);
    return runtime;
}

/** What a manifest's component NAME means in this runtime. */
function componentNamed(name: string): AnyComponentDef | undefined {
    return getComponent(name);
}

/**
 * Where things are, asked of the world. One question for both kinds of
 * component, because a system may name an engine one and a script one in the
 * same query and the runner has no business knowing which is which.
 */
export function worldAddresses(world: World, resources: AotResources): AotAddresses {
    return {
        componentNamed,
        componentAt: (component: AnyComponentDef, entity: Entity) =>
            world.addressOfComponent(component, entity),
        resourceAt: (name: string) => resources.addressOf(name),
    };
}
