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
import { resourceFields } from '../resourceShapes';

/** Reads the live value of a named resource, or undefined if the world has none. */
export type ResourceReader = (name: string) => Readonly<Record<string, unknown>> | undefined;

/**
 * Blocks for the resources compiled systems read, refreshed on demand. One per
 * world; a resource with no declared shape simply has no address, and a system
 * naming it did not compile.
 */
export class AotResources {
    private readonly blocks = new Map<string, PoolBlock>();
    private readonly views = new Map<string, Float64Array>();

    constructor(private readonly memory: PoolMemory, private readonly read: ResourceReader) {}

    /**
     * The address of `name`'s bytes, with this frame's values in them, or
     * undefined when the resource has no layout or the world has no value.
     */
    addressOf(name: string): number | undefined {
        const fields = resourceFields(name);
        if (!fields) return undefined;
        const value = this.read(name);
        if (!value) return undefined;

        let block = this.blocks.get(name);
        if (!block) {
            block = this.memory.alloc(fields.length * POOL_SLOT_BYTES);
            this.blocks.set(name, block);
        }
        // Re-viewed rather than held: allocating anything may have grown the
        // heap, and a grown heap detaches every view of it.
        const buffer = this.memory.current?.(block) ?? block.buffer;
        let view = this.views.get(name);
        if (!view || view.buffer !== buffer) {
            view = new Float64Array(buffer, block.byteOffset, fields.length);
            this.views.set(name, view);
        }
        fields.forEach((field, i) => {
            const v = value[field];
            view![i] = typeof v === 'boolean' ? (v ? 1 : 0) : (typeof v === 'number' ? v : 0);
        });
        return block.byteOffset;
    }

    dispose(): void {
        for (const block of this.blocks.values()) this.memory.release(block);
        this.blocks.clear();
        this.views.clear();
    }
}
