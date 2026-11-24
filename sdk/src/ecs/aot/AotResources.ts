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
import { disposeAll } from '../../util/disposeAll';
import type { AotManifest } from './AotSystems';
import {
    resourceBitSource, resourceBlockBytes, resourceLayout, type ResourceMember,
} from '../resourceShapes';

/** Reads the live value of a named resource, or undefined if the world has none. */
export type ResourceReader = (name: string) => Readonly<Record<string, unknown>> | undefined;

/** The live resource's field order for the module handshake. */
export function resourceFieldNames(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    return value !== null && typeof value === 'object' ? Object.keys(value) : [];
}

/** Project resource layouts in the field order emitted by the compiler. */
export function declaredResourceLayouts(manifest: AotManifest): Map<string, readonly string[]> {
    const layouts = new Map<string, readonly string[]>();
    for (const system of manifest.systems) {
        for (const resource of system.resources) if (resource.fields) layouts.set(resource.name, resource.fields);
    }
    return layouts;
}

interface ResourceMirror {
    readonly layout: readonly ResourceMember[];
    readonly bytes: number;
    block?: PoolBlock;
    scratch?: Uint8Array;
}

/**
 * Blocks for the resources compiled systems read, refreshed on demand. One per
 * world; a resource with no declared shape simply has no address, and a system
 * naming it did not compile.
 */
export class AotResources {
    private readonly mirrors = new Map<string, ResourceMirror>();
    private disposed = false;

    constructor(
        private readonly memory: PoolMemory,
        private readonly read: ResourceReader,
        /**
         * Layouts for the resources the PROJECT declared, from the manifest.
         * The engine's own come from `resourceShapes.ts`; a project's cannot,
         * and a build is the only thing that knows the order it compiled for.
         */
        private readonly declared: ReadonlyMap<string, readonly string[]> = new Map(),
    ) {}

    private mirrorFor(name: string): ResourceMirror | undefined {
        const known = this.mirrors.get(name);
        if (known) return known;
        const fields = this.declared.get(name);
        const layout = resourceLayout(name) ?? fields?.map((field, i): ResourceMember =>
            ({ kind: 'scalar', name: field, offset: i * POOL_SLOT_BYTES }));
        if (!layout) return undefined;
        const bytes = fields ? fields.length * POOL_SLOT_BYTES : resourceBlockBytes(name);
        const mirror = { layout, bytes };
        this.mirrors.set(name, mirror);
        return mirror;
    }

    /** How many bytes `name`'s mirror is, for a host that must be given a range. */
    bytesOf(name: string): number {
        return this.mirrorFor(name)?.bytes ?? 0;
    }

    /**
     * The address of `name`'s bytes, with this frame's values in them, or
     * undefined when the resource has no layout or the world has no value.
     */
    addressOf(name: string): number | undefined {
        if (this.disposed) throw new Error('AotResources is disposed');
        const mirror = this.mirrorFor(name);
        if (!mirror) return undefined;
        const value = this.read(name);
        if (!value || this.disposed) return undefined;

        // A field getter or input service can grow the engine heap. Take its answers
        // in JS memory, then publish them in one copy into the current engine buffer.
        const view = mirror.scratch ?? new Uint8Array(mirror.bytes);
        mirror.scratch = undefined; // A nested read needs its own in-progress snapshot.
        try {
            const f64 = new Float64Array(view.buffer);
            for (const member of mirror.layout) {
                if (member.kind === 'scalar') {
                    const v = value[member.name];
                    f64[member.offset / POOL_SLOT_BYTES] =
                        typeof v === 'boolean' ? (v ? 1 : 0) : (typeof v === 'number' ? v : 0);
                } else {
                    this.fillBits(name, member.name, member.offset, member.bits, view, value);
                }
            }
            if (this.disposed) return undefined;
            const block = mirror.block ??= this.memory.alloc(mirror.bytes);
            const buffer = this.memory.current?.(block) ?? block.buffer;
            new Uint8Array(buffer, block.byteOffset, mirror.bytes).set(view);
            return block.byteOffset;
        } finally {
            mirror.scratch = view;
        }
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
        const mirror = this.mirrors.get(name);
        if (!mirror?.block) return;
        const { block, layout, bytes } = mirror;
        // Read the whole result before calling user getters or setters. Both can grow the heap.
        const buffer = this.memory.current?.(block) ?? block.buffer;
        const f64 = new Float64Array(buffer, block.byteOffset, bytes / POOL_SLOT_BYTES).slice();
        const value = this.read(name) as Record<string, unknown> | undefined;
        if (!value || this.disposed) return;
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
        this.disposed = true;
        const mirrors = [...this.mirrors.values()];
        this.mirrors.clear();
        disposeAll(mirrors, mirror => { if (mirror.block) this.memory.release(mirror.block); });
    }
}
