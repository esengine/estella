// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ScriptPool.ts
 * @brief   Flat storage for a script component whose fields are all scalars.
 *
 * @details A `defineComponent` component is a JS object per entity, which is
 *          fine for the interpreter and impossible for compiled code: a compiled
 *          system reaches a component by ADDRESS, and a JS object has none. So a
 *          component whose defaults are entirely numbers and booleans is stored
 *          in one Float64Array instead, and what callers hold is a live view
 *          onto a row of it.
 *
 *          The layout is the ABI's, not one chosen here: declaration order, one
 *          f64 per field, which is what `packLayout` gives a `host` shape. That
 *          agreement is a contract with the compiler and a test holds it.
 *
 *          A view is LIVE, and for script components that changes nothing: the
 *          query already yields the stored object itself and `writeMutBack_`
 *          only records a Changed tick for them. Writing through a setter is the
 *          same write it always was, one indirection later.
 */

import { entityIndex, type Entity } from '../types';

/** What a pooled field holds. Booleans are 0/1 in the slot, `true`/`false` out. */
export type PoolKind = 'number' | 'boolean';

export interface PoolField {
    readonly name: string;
    readonly kind: PoolKind;
}

/** One f64 per field: what the ABI gives a host record. */
export const POOL_SLOT_BYTES = 8;

/** A byte range the pool was given, and where it starts in the host's memory. */
export interface PoolBlock {
    readonly buffer: ArrayBufferLike;
    readonly byteOffset: number;
    readonly byteLength: number;
}

/**
 * Where a pool's storage is allocated FROM. The default is the JS heap, which
 * suits a native host: same process, real address. A wasm host must pass linear
 * memory, because compiled code inside the module cannot reach a JS-heap array —
 * and unreachable is what rows exist to stop being.
 */
export interface PoolMemory {
    alloc(bytes: number): PoolBlock;
    release(block: PoolBlock): void;
    /**
     * The block's buffer as it is NOW. A wasm heap that grows DETACHES the one
     * handed out at `alloc` while the bytes stay at the same offset, so a pool
     * that held the old object would read undefined and never say why.
     */
    current?(block: PoolBlock): ArrayBufferLike;
}

/** Storage on the JS heap: right for native, useless to a wasm module. */
export const HEAP_MEMORY: PoolMemory = {
    alloc: (bytes) => ({ buffer: new ArrayBuffer(bytes), byteOffset: 0, byteLength: bytes }),
    release: () => { /* the collector owns it */ },
};

/** Absent, in the sparse table: a slot is stored as `slot + 1`. */
export const POOL_ABSENT = 0;

/**
 * The fields a pool can back, or null when the defaults are not all scalars.
 * Anything else — a string, an asset ref, a nested object, an array — has no
 * fixed-width encoding, and a component holding one keeps the JS object path.
 */
export function poolShape(defaults: unknown): PoolField[] | null {
    if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) return null;
    const fields: PoolField[] = [];
    for (const [name, v] of Object.entries(defaults as Record<string, unknown>)) {
        if (typeof v === 'number') fields.push({ name, kind: 'number' });
        else if (typeof v === 'boolean') fields.push({ name, kind: 'boolean' });
        else return null;
    }
    return fields.length > 0 ? fields : null;
}

/**
 * Rows of one component, and a view per live entity. Slots come from a free list
 * rather than being compacted, so a view stays valid while its entity carries
 * the component: an index that moved under a held view is a bug that surfaces
 * three frames later. Iteration order lives in the map that holds the views.
 */
export class ScriptPool {
    readonly fields: readonly PoolField[];
    /** Bytes per row, and what the ABI's `stride` must agree with. */
    readonly stride: number;

    private rows_: PoolBlock;
    private slots_: Float64Array;
    private sparseBlock_: PoolBlock;
    /** Entity index -> slot + 1, so zero means absent. The engine's sparse set
     *  in the same shape, and the reason a host needs no call to resolve a row. */
    private sparse_: Uint32Array;
    private sparseLen_: number;
    private capacity_: number;
    private readonly slotOf_ = new Map<Entity, number>();
    private readonly views_ = new Map<Entity, Record<string, unknown>>();
    private readonly free_: number[] = [];
    private next_ = 0;

    constructor(
        fields: readonly PoolField[],
        capacity = 64,
        private readonly memory_: PoolMemory = HEAP_MEMORY,
    ) {
        this.fields = fields;
        this.stride = fields.length * POOL_SLOT_BYTES;
        this.capacity_ = Math.max(1, capacity);
        // BOTH allocations before EITHER view. The second can grow the heap, and
        // a grown heap detaches a view built after the first — which is a bug
        // this constructor had, and the reason every view is built in one place.
        this.rows_ = memory_.alloc(this.capacity_ * this.stride);
        this.sparseBlock_ = memory_.alloc(this.capacity_ * 4);
        this.sparseLen_ = this.capacity_;
        this.slots_ = EMPTY_F64;
        this.sparse_ = EMPTY_U32;
        this.rebuild_();
    }

    /**
     * What a host needs to resolve this component WITHOUT calling back: rows at
     * a constant stride, and a sparse table saying which slot an entity is in.
     * Every address is in the memory the pool allocated from.
     *
     * Valid until the next growth, which is per call anyway.
     */
    span(): { rows: number; stride: number; sparse: number; sparseCount: number } {
        return {
            rows: this.rows_.byteOffset,
            stride: this.stride,
            sparse: this.sparseBlock_.byteOffset,
            sparseCount: this.sparse_.length,
        };
    }

    /** The sparse table itself, for a host that reads it in this address space. */
    get sparseTable(): Uint32Array {
        return this.sparse_;
    }

    /**
     * Rebuild the views over whatever buffer the blocks are in now: a grown wasm
     * heap leaves the bytes at the same offsets but detaches every view of the
     * old ArrayBuffer. Cheap and idempotent, so call it when unsure — the
     * per-entity views read `slots_` on access and need no rebuild.
     */
    refresh(): void {
        this.rebuild_();
    }

    /** Every view of this pool's storage, made in ONE place. Anything that can
     *  have detached a view calls this rather than fixing up the one it knows
     *  about — the heap grows for all of them at once. */
    private rebuild_(): void {
        this.slots_ = new Float64Array(this.bufferOf_(this.rows_), this.rows_.byteOffset,
            this.capacity_ * this.fields.length);
        this.sparse_ = new Uint32Array(this.bufferOf_(this.sparseBlock_),
            this.sparseBlock_.byteOffset, this.sparseLen_);
    }

    private bufferOf_(block: PoolBlock): ArrayBufferLike {
        return this.memory_.current?.(block) ?? block.buffer;
    }

    /** The rows themselves. Its byteOffset moves when the pool grows, so an
     *  address taken from `address` is valid only until the next `put`. */
    get buffer(): Float64Array {
        return this.slots_;
    }

    get size(): number {
        return this.slotOf_.size;
    }

    /** Byte offset of `entity`'s row inside `buffer`. */
    baseOf(entity: Entity): number | undefined {
        const slot = this.slotOf_.get(entity);
        return slot === undefined ? undefined : slot * this.stride;
    }

    /**
     * The address a host hands to compiled code: the row's offset in the memory
     * the pool allocated from, not in the pool's own view. The two differ by
     * `byteOffset` once the rows are carved out of a larger block. Valid until
     * the next growth, which a one-call lifetime requires anyway.
     */
    address(entity: Entity): number | undefined {
        const base = this.baseOf(entity);
        return base === undefined ? undefined : this.slots_.byteOffset + base;
    }

    has(entity: Entity): boolean {
        return this.slotOf_.has(entity);
    }

    /** The live view, or undefined when the entity does not carry this. */
    get(entity: Entity): Record<string, unknown> | undefined {
        return this.views_.get(entity);
    }

    /**
     * Give `entity` a row seeded from `defaults` and overlaid with `data`, or
     * overwrite the fields `data` names on the row it already has. Returns the
     * view either way, and whether the row is new.
     */
    put(entity: Entity, defaults: Record<string, unknown>, data?: Record<string, unknown>):
    { view: Record<string, unknown>; isNew: boolean } {
        let slot = this.slotOf_.get(entity);
        const isNew = slot === undefined;
        if (slot === undefined) {
            slot = this.claim_(entity);
            this.slotOf_.set(entity, slot);
            this.mark_(entity, slot + 1);
            this.views_.set(entity, this.makeView_(slot));
            // A fresh row is seeded whole; an existing one keeps the fields the
            // caller did not name, which is what `world.set` has always done.
            this.writeAll_(slot, defaults);
        }
        if (data) this.writeSome_(slot, data);
        return { view: this.views_.get(entity)!, isNew };
    }

    delete(entity: Entity): boolean {
        const slot = this.slotOf_.get(entity);
        if (slot === undefined) return false;
        this.slotOf_.delete(entity);
        this.views_.delete(entity);
        this.mark_(entity, POOL_ABSENT);
        this.free_.push(slot);
        return true;
    }

    entities(): IterableIterator<Entity> {
        return this.slotOf_.keys();
    }

    // -------------------------------------------------------------------------

    private claim_(entity: Entity): number {
        const reused = this.free_.pop();
        if (reused !== undefined) return reused;
        if (this.next_ >= this.capacity_) this.growRows_();
        this.reserveSparse_(entityIndex(entity) + 1);
        return this.next_++;
    }

    private mark_(entity: Entity, value: number): void {
        const at = entityIndex(entity);
        this.reserveSparse_(at + 1);
        this.sparse_[at] = value;
    }

    private growRows_(): void {
        const want = this.capacity_ * 2;
        const block = this.memory_.alloc(want * this.stride);
        // Before reading the old rows, not after: allocating may have grown the
        // heap, and a grown heap detaches the view this is about to copy FROM.
        this.rebuild_();
        const wider = new Float64Array(this.bufferOf_(block), block.byteOffset,
            want * this.fields.length);
        wider.set(this.slots_);
        const old = this.rows_;
        this.capacity_ = want;
        this.rows_ = block;
        this.slots_ = wider;
        this.memory_.release(old);
        // Views hold a slot index, not a reference into the old array, so they
        // survive this. An ADDRESS taken before it does not, which is why
        // `address` says so.
        for (const [entity, slot] of this.slotOf_) {
            this.views_.set(entity, this.makeView_(slot));
        }
    }

    /** The sparse table is indexed by ENTITY INDEX, which the world hands out
     *  and this pool does not control, so it grows on its own schedule. */
    private reserveSparse_(want: number): void {
        if (want <= this.sparseLen_) return;
        let size = Math.max(this.sparseLen_ * 2, 8);
        while (size < want) size *= 2;
        const block = this.memory_.alloc(size * 4);
        this.rebuild_();   // same trap as growRows_: the source may have detached
        const wider = new Uint32Array(this.bufferOf_(block), block.byteOffset, size);
        wider.set(this.sparse_);
        const old = this.sparseBlock_;
        this.sparseBlock_ = block;
        this.sparse_ = wider;
        this.sparseLen_ = size;
        this.memory_.release(old);
    }

    private writeAll_(slot: number, from: Record<string, unknown>): void {
        const base = slot * this.fields.length;
        this.fields.forEach((f, i) => {
            this.slots_[base + i] = toSlot(from[f.name]);
        });
    }

    private writeSome_(slot: number, from: Record<string, unknown>): void {
        const base = slot * this.fields.length;
        this.fields.forEach((f, i) => {
            const v = from[f.name];
            if (v !== undefined) this.slots_[base + i] = toSlot(v);
        });
    }

    /** One object per entity, with an accessor per field onto its row. */
    private makeView_(slot: number): Record<string, unknown> {
        const base = slot * this.fields.length;
        const view: Record<string, unknown> = {};
        this.fields.forEach((f, i) => {
            const at = base + i;
            Object.defineProperty(view, f.name, {
                enumerable: true,
                configurable: true,
                get: f.kind === 'boolean'
                    ? (): boolean => this.slots_[at] !== 0
                    : (): number => this.slots_[at]!,
                set: (v: unknown): void => { this.slots_[at] = toSlot(v); },
            });
        });
        return view;
    }
}

/** Placeholders, so the constructor can allocate before it views. */
const EMPTY_F64 = new Float64Array(0);
const EMPTY_U32 = new Uint32Array(0);

/** A slot holds a number; a boolean is the 0/1 the ABI stores it as. */
function toSlot(v: unknown): number {
    if (typeof v === 'boolean') return v ? 1 : 0;
    return typeof v === 'number' ? v : 0;
}
