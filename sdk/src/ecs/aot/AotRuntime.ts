// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotRuntime.ts
 * @brief   What the runner needs to call a twin instead of a closure.
 *
 * @details Three things, and no more: which twins exist, what the manifest's
 *          names mean here, and one arena to lay a call out in.
 *
 *          A COMPONENT's address is deliberately absent: `AotDispatch` asks the
 *          world for a resolver once per system and calls it per row, and a
 *          second door onto the same fact is a second thing to keep true.
 *          A resource's is here because a resource has no address of its own
 *          until something mirrors it, and that something is per world.
 */

import type { AnyComponentDef } from '../component';
import type { AotContext } from './AotContext';
import type { AotSystems } from './AotSystems';

/** Where the bytes are, in the memory the compiled code reads. */
export interface AotAddresses {
    /**
     * The named resource's bytes, ready for THIS call. A resource is a host
     * record with no address of its own, so an implementation mirrors it — and
     * doing that per call rather than per row is why it is one call.
     */
    resourceAt(name: string): number | undefined;
    /** Copy the mirror back, for a resource the system declared `ResMut`. */
    resourceWriteBack(name: string): void;
    /**
     * This frame's payloads of `event`, as rows: one per payload, each carrying
     * the address of a block laid out in `fields` order. Entity-less, because
     * an event is not carried by one.
     */
    payloadRows(event: string, fields: readonly string[]): readonly (readonly number[])[];
    /** Deliver one payload the compiled code appended, rebuilt from `fields`. */
    sendEvent(event: string, fields: readonly string[], values: readonly number[]): void;
    /** Hand back the blocks `payloadRows` took; they outlive no call. */
    releasePayloads(): void;
    /** The definition a manifest's component NAME refers to in this world. */
    componentNamed(name: string): AnyComponentDef | undefined;
}

/**
 * Installed by a shipping build, absent everywhere else. That absence is the
 * whole of the mode policy: with no twins there is nothing to dispatch to, so
 * the editor and dev builds need no flag and take no branch worth measuring.
 */
export interface AotRuntime {
    readonly systems: AotSystems;
    readonly addresses: AotAddresses;
    readonly ctx: AotContext;
}
