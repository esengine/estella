// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    executorCapabilities.ts
 * @brief   What a road can carry out of a call, and what a system needs carried.
 *
 * @details A twin is only a twin where the road can do everything the closure
 *          did. Two of those turned out not to be true of every road, and both
 *          failed silently in their own way:
 *
 *          - EVENTS. A loading host hands the call `events = 0` and the emitted
 *            C dereferences it in the prologue, so a writer's twin faults on a
 *            frame where the system would have done nothing.
 *          - COMMANDS. The C++ host applies a despawn to its Registry inside
 *            the call and nothing tells the SDK's World, so the entity stays in
 *            every query, its children are never torn down and its script rows
 *            are never freed. Measured: four entities, eight frames, the
 *            interpreted road counts 3,2,1,0 and the compiled one counts 4.
 *
 *          Queries and resources are deliberately NOT here. A host that cannot
 *          name a component leaves the system unbound at the first call, which
 *          is a per-frame answer about this world rather than a standing fact
 *          about the road — and the fallback already covers it.
 *
 *          An unsupported capability is a FALLBACK, never a half-support: the
 *          interpreter still has the closure, and running it is the correct
 *          answer rather than the degraded one.
 */
import type { AotSystemDecl } from './AotSystems';

/** The parts of a call a road may not be able to carry. */
export interface AotExecutorCapabilities {
    /** Payloads delivered INTO a call, as a query slot of event rows. */
    readonly eventRead: boolean;
    /** Payloads appended BY a call, which the host has to deliver after it. */
    readonly eventWrite: boolean;
    /** Command records appended by a call, which the host has to apply — to the
     *  same world the interpreter would have applied them to. */
    readonly commands: boolean;
}

/**
 * The wasm road: the module shares the engine's memory, so every table the ctx
 * carries has somewhere to live and `AotDispatch` drains all of them.
 */
export const WEB_AOT: AotExecutorCapabilities = {
    eventRead: true,
    eventWrite: true,
    commands: true,
};

/**
 * The loading road: a host in its own process, packing its own rows.
 *
 * Neither event table exists (`AotHost.hpp` fills `events = 0`), and commands
 * are applied to the C++ Registry by `es_aot_run` — a world the SDK's own
 * `World.despawn` is not part of, so a despawn there is half a despawn.
 */
export const NATIVE_AOT: AotExecutorCapabilities = {
    eventRead: false,
    eventWrite: false,
    commands: false,
};

/** What this system needs a road to carry, off what the build declared. */
export function requiredCapabilities(decl: AotSystemDecl): AotExecutorCapabilities {
    return {
        eventRead: (decl.readers?.length ?? 0) > 0,
        eventWrite: (decl.writers?.length ?? 0) > 0,
        // Absent means a manifest older than this field, and the road that
        // cannot flush them is the one that would crash quietly: assume the
        // system commands rather than assume it does not.
        commands: decl.commands ?? true,
    };
}

/** Every capability this system needs that the road does not have. */
export function missingCapabilities(
    decl: AotSystemDecl,
    road: AotExecutorCapabilities,
): (keyof AotExecutorCapabilities)[] {
    const need = requiredCapabilities(decl);
    return (Object.keys(need) as (keyof AotExecutorCapabilities)[])
        .filter((k) => need[k] && !road[k]);
}

/** What to say when a road leaves a system to the interpreter, in one place so
 *  both roads say it the same way. */
export function whyInterpreted(name: string, missing: readonly string[]): string {
    const what = missing.map((m) => SAID[m] ?? m).join(' and ');
    return `AOT: ${name} needs ${what}, which this host cannot hand compiled code `
        + '— the interpreter keeps it';
}

const SAID: Record<string, string> = {
    eventRead: 'to read events',
    eventWrite: 'to write events',
    commands: 'to append commands',
};
