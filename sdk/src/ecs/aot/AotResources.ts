// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotResources.ts
 * @brief   A resource's bytes, for code that reaches it by address.
 *
 * @details A resource is a host record — a JS object with no address — and a
 *          compiled system reads one at `base + offset` like anything else. So
 *          each resource a twin declares gets a block in the engine's memory and
 *          its values are written there before the call.
 *
 *          That IS a copy, and it is the one copy this design keeps. The reason
 *          it is affordable is the shape of it: one small record per resource
 *          per system call, not one per component per entity per frame, which is
 *          the per-row cost AOT exists to delete.
 *
 *          The layout is `resourceShapes.ts`, which is also what the compiler
 *          reads. Order is the layout, so a second list here would be a second
 *          answer — `pool-layout.test.ts` holds the two together.
 */

import { POOL_SLOT_BYTES, type PoolBlock, type PoolMemory } from '../ScriptPool';
import { resourceBitSource, resourceBlockBytes, resourceLayout } from '../resourceShapes';

/** Reads the live value of a named resource, or undefined if the world has none. */
export type ResourceReader = (name: string) => Readonly<Record<string, unknown>> | undefined;

/**
 * Blocks for the resources compiled systems read, refreshed on demand. One per
 * world; a resource with no declared shape simply has no address, and a system
 * naming it did not compile.
 */
export class AotResources {
    private readonly blocks = new Map<string, PoolBlock>();
    private readonly views = new Map<string, Uint8Array>();

    constructor(private readonly memory: PoolMemory, private readonly read: ResourceReader) {}

    /**
     * The address of `name`'s bytes, with this frame's values in them, or
     * undefined when the resource has no layout or the world has no value.
     */
    addressOf(name: string): number | undefined {
        const layout = resourceLayout(name);
        if (!layout) return undefined;
        const value = this.read(name);
        if (!value) return undefined;

        let block = this.blocks.get(name);
        if (!block) {
            block = this.memory.alloc(resourceBlockBytes(name));
            this.blocks.set(name, block);
        }
        // Re-viewed rather than held: allocating anything may have grown the
        // heap, and a grown heap detaches every view of it.
        const buffer = this.memory.current?.(block) ?? block.buffer;
        let view = this.views.get(name);
        if (!view || view.buffer !== buffer) {
            view = new Uint8Array(buffer, block.byteOffset, resourceBlockBytes(name));
            this.views.set(name, view);
        }
        const f64 = new Float64Array(view.buffer, view.byteOffset, view.byteLength / POOL_SLOT_BYTES);
        for (const member of layout) {
            if (member.kind === 'scalar') {
                const v = value[member.name];
                f64[member.offset / POOL_SLOT_BYTES] =
                    typeof v === 'boolean' ? (v ? 1 : 0) : (typeof v === 'number' ? v : 0);
                continue;
            }
            this.fillBits(name, member.name, member.offset, member.bits, view, value);
        }
        return block.byteOffset;
    }

    /**
     * One bit per key, from the resource's OWN method. That is a call per key
     * per system call — bounded by the declared table, and paid only by a system
     * that named the resource. Reading the state behind the method instead would
     * be cheaper and would answer a different question inside a fixed step.
     */
    private fillBits(
        resource: string, set: string, offset: number, bits: number,
        view: Uint8Array, value: Readonly<Record<string, unknown>>,
    ): void {
        const bytes = Math.ceil(bits / 8);
        view.fill(0, offset, offset + bytes);
        const source = resourceBitSource(resource, set);
        const ask = source && value[source.method];
        if (!source || typeof ask !== 'function') return;
        source.keys.forEach((key, i) => {
            if ((ask as (k: unknown) => unknown).call(value, key) === true) {
                view[offset + (i >> 3)]! |= 1 << (i & 7);
            }
        });
    }

    /**
     * Copy `name`'s block back onto the live resource, for a system that
     * declared `ResMut`: a mirror nobody reads back is a write that did not
     * happen. A field the resource does not hold as a number or a boolean is
     * skipped, because the block never carried it.
     */
    writeBack(name: string): void {
        const layout = resourceLayout(name);
        const view = this.views.get(name);
        const value = this.read(name) as Record<string, unknown> | undefined;
        if (!layout || !view || !value) return;
        const f64 = new Float64Array(view.buffer, view.byteOffset, view.byteLength / POOL_SLOT_BYTES);
        for (const member of layout) {
            // Bit sets are a service's answers, not its state: there is nothing
            // on the other side to assign back to.
            if (member.kind !== 'scalar') continue;
            const was = value[member.name];
            const now = f64[member.offset / POOL_SLOT_BYTES]!;
            if (typeof was === 'boolean') value[member.name] = now !== 0;
            else if (typeof was === 'number') value[member.name] = now;
        }
    }

    dispose(): void {
        for (const block of this.blocks.values()) this.memory.release(block);
        this.blocks.clear();
        this.views.clear();
    }
}
