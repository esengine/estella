// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotRuntime.ts
 * @brief   What the runner needs to call a twin instead of a closure.
 *
 * @details Three things, and no more: which twins exist, where a component's and
 *          a resource's bytes are, and one arena to lay a call out in.
 *
 *          Addresses are asked for by DEFINITION and by NAME rather than
 *          resolved here, because where a component lives depends on which kind
 *          it is — an engine component is at an EHT offset in the C++ pools, a
 *          `defineComponent` one is a row in a `ScriptPool` — and that is the
 *          storage layer's knowledge, not this one's.
 */

import type { AnyComponentDef } from '../component';
import type { Entity } from '../../types';
import type { AotContext } from './AotContext';
import type { AotSystems } from './AotSystems';

/** Where the bytes are, in the memory the compiled code reads. */
export interface AotAddresses {
    /** `component`'s bytes for `entity`, or undefined when it has none. */
    componentAt(component: AnyComponentDef, entity: Entity): number | undefined;
    /**
     * The named resource's bytes, ready for THIS call. A resource is a host
     * record with no address of its own, so an implementation mirrors it — and
     * doing that per call rather than per row is why it is one call.
     */
    resourceAt(name: string): number | undefined;
    /** The definition a manifest's component NAME refers to in this world. */
    componentNamed(name: string): AnyComponentDef | undefined;
}

/**
 * Installed by a shipping build, absent everywhere else. That absence is the
 * whole of the mode policy: with no twins there is nothing to dispatch to, so
 * the editor and dev builds need no flag and take no branch worth measuring
 * (docs/REARCH_AOT.md §9).
 */
export interface AotRuntime {
    readonly systems: AotSystems;
    readonly addresses: AotAddresses;
    readonly ctx: AotContext;
}
