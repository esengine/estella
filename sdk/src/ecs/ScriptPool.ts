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
import { disposeAll } from '../util/disposeAll';

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
    /** Stable allocator ownership, not merely a buffer. Compatible wrappers may
     * reuse existing rows without moving them to a different allocation domain. */
    readonly allocatorIdentity?: object;
    alloc(bytes: number): PoolBlock;
    release(block: PoolBlock): void;
    /**
     * The block's buffer as it is NOW. A wasm heap that grows DETACHES the one
     * handed out at `alloc` while the bytes stay at the same offset, so a pool
     * that held the old object would read undefined and never say why.
     */
    current?(block: PoolBlock): ArrayBufferLike;
}

interface PoolAssetRefs {
    fields(): readonly { readonly field: string }[];
    addressChanged(): void;
}

interface PoolView {
    readonly value: Record<string, unknown>;
    detach(): void;
}

/** Storage on the JS heap: right for native, useless to a wasm module. */
export const HEAP_MEMORY: PoolMemory = {
    alloc: (bytes) => ({ buffer: new ArrayBuffer(bytes), byteOffset: 0, byteLength: bytes }),
    release: () => { /* the collector owns it */ },
};

/** Absent, in the sparse table: a slot is stored as `slot + 1`. */
export const POOL_ABSENT = 0;

/**
 * A slot no entity holds, in the owner table. `Entity::INVALID_RAW` on the C++
 * side, which is the one raw handle the world never hands out — so a host
 * walking the column reads a hole as an entity nothing resolves for, and its
 * existing completeness check drops the row.
 */
export const POOL_NO_OWNER = 0xffffffff;

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
    private ownersBlock_: PoolBlock;
    /** Slot -> the entity holding it, so a host can ask WHO is in this column.
     *  The sparse table answers the other direction and cannot answer this one,
     *  and without it a compiled system has to be offered every entity alive. */
    private owners_: Uint32Array;
    private capacity_: number;
    private readonly slotOf_ = new Map<Entity, number>();
    private readonly views_ = new Map<Entity, PoolView>();
    private readonly free_: number[] = [];
    private next_ = 0;
    // Portable asset references have no numeric ABI representation yet. Keep
    // them beside the row until resolved, without giving compiled code an
    // address that would silently reinterpret a string as zero.
    private refs_: Map<number, Map<number, string>> | undefined;
    private disposed_ = false;

    get disposed(): boolean { return this.disposed_; }

    dispose(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        const views = [...this.views_.values()];
        const blocks = [this.rows_, this.sparseBlock_, this.ownersBlock_];
        disposeAll([
            () => this.rebuild_(),
            () => disposeAll(views, view => view.detach()),
            () => {
                this.slotOf_.clear(); this.views_.clear(); this.refs_?.clear();
                this.free_.length = 0; this.next_ = 0;
                this.slots_ = EMPTY_F64; this.sparse_ = EMPTY_U32; this.owners_ = EMPTY_U32;
                this.rows_ = this.sparseBlock_ = this.ownersBlock_ = EMPTY_BLOCK;
            },
            () => disposeAll(blocks, block => this.memory_.release(block)),
        ], action => action());
    }

    private assertOpen_(): void {
        if (this.disposed_) throw new Error('ScriptPool is disposed');
    }

    constructor(
        fields: readonly PoolField[],
        capacity = 64,
        private readonly memory_: PoolMemory = HEAP_MEMORY,
        private readonly assetRefs_?: PoolAssetRefs,
    ) {
        this.fields = fields;
        this.stride = fields.length * POOL_SLOT_BYTES;
        this.capacity_ = Math.max(1, capacity);
        // BOTH allocations before EITHER view. The second can grow the heap, and
        // a grown heap detaches a view built after the first — which is a bug
        // this constructor had, and the reason every view is built in one place.
        const allocated: PoolBlock[] = [];
        try {
            this.rows_ = memory_.alloc(this.capacity_ * this.stride); allocated.push(this.rows_);
            this.sparseBlock_ = memory_.alloc(this.capacity_ * 4); allocated.push(this.sparseBlock_);
            this.sparseLen_ = this.capacity_;
            this.ownersBlock_ = memory_.alloc(this.capacity_ * 4); allocated.push(this.ownersBlock_);
            this.slots_ = EMPTY_F64;
            this.sparse_ = EMPTY_U32;
            this.owners_ = EMPTY_U32;
            this.rebuild_();
            this.owners_.fill(POOL_NO_OWNER);
        } catch (error) {
            // Preserve the allocation/view failure even if cleanup also fails.
            try { disposeAll(allocated, block => memory_.release(block)); } catch {}
            throw error;
        }
    }

    /**
     * What a host needs to resolve this component WITHOUT calling back: rows at
     * a constant stride, and a sparse table saying which slot an entity is in.
     * Every address is in the memory the pool allocated from.
     *
     * Valid until the next growth, which is per call anyway.
     */
    span(): {
        rows: number; stride: number; sparse: number; sparseCount: number;
        owners: number; ownerCount: number;
    } {
        this.assertOpen_();
        return {
            rows: this.rows_.byteOffset,
            stride: this.stride,
            sparse: this.sparseBlock_.byteOffset,
            sparseCount: this.sparseLen_,
            owners: this.ownersBlock_.byteOffset,
            // The high-water mark, not the size: slots are reused rather than
            // compacted, so the used prefix has holes and stopping at `size`
            // would stop short of live rows sitting above a freed one.
            ownerCount: this.next_,
        };
    }

    /** The current sparse view. Retrieve it again after pool or heap growth;
     *  a held typed array cannot follow replacement or detached memory. */
    get sparseTable(): Uint32Array {
        this.ensureCurrent_();
        return this.sparse_;
    }

    /**
     * Rebuild the views over whatever buffer the blocks are in now: a grown wasm
     * heap leaves the bytes at the same offsets but detaches every view of the
     * old ArrayBuffer. Cheap and idempotent, so call it when unsure — the
     * per-entity views read `slots_` on access and need no rebuild.
     */
    refresh(): void {
        this.assertOpen_();
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
        this.owners_ = new Uint32Array(this.bufferOf_(this.ownersBlock_),
            this.ownersBlock_.byteOffset, this.capacity_);
    }

    private bufferOf_(block: PoolBlock): ArrayBufferLike {
        return this.memory_.current?.(block) ?? block.buffer;
    }

    private ensureCurrent_(): void {
        // Foreign allocations (resources, compiled scratch, engine assets) can
        // grow the shared WASM heap without passing through ScriptStorage.
        // Live row allocations are never empty; zero means their view detached.
        if (this.slots_.length === 0 && !this.disposed_) this.rebuild_();
    }

    /** The current row view. Retrieve it again after pool or heap growth.
     *  Pool growth moves row addresses; foreign heap growth detaches views
     *  while allocation addresses stay unchanged. */
    get buffer(): Float64Array {
        this.ensureCurrent_();
        return this.slots_;
    }

    get size(): number {
        return this.slotOf_.size;
    }

    get hasPortableAssetRefs(): boolean {
        return (this.refs_?.size ?? 0) > 0;
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
        const slot = this.slotOf_.get(entity);
        if (slot === undefined || this.refs_?.has(slot)) return undefined;
        // Addresses belong to allocations, not detachable typed-array views.
        return this.rows_.byteOffset + slot * this.stride;
    }

    has(entity: Entity): boolean {
        return this.slotOf_.has(entity);
    }

    /** The live view, or undefined when the entity does not carry this. */
    get(entity: Entity): Record<string, unknown> | undefined {
        return this.views_.get(entity)?.value;
    }

    /**
     * Give `entity` a row seeded from `defaults` and overlaid with `data`, or
     * overwrite the fields `data` names on the row it already has. Returns the
     * view either way, and whether the row is new.
     */
    put(entity: Entity, defaults: Record<string, unknown>, data?: Record<string, unknown>):
    { view: Record<string, unknown>; isNew: boolean } {
        this.assertOpen_();
        this.ensureCurrent_();
        let slot = this.slotOf_.get(entity);
        const isNew = slot === undefined;
        if (slot === undefined) {
            slot = this.claim_(entity);
            this.slotOf_.set(entity, slot);
            this.mark_(entity, slot + 1);
            // After `claim_`, which may have grown the pool and rebuilt this view.
            this.owners_[slot] = entity;
            this.views_.set(entity, this.makeView_(slot));
            // A fresh row is seeded whole; an existing one keeps the fields the
            // caller did not name, which is what `world.set` has always done.
            this.writeAll_(slot, defaults);
        }
        if (data) this.writeSome_(slot, data);
        return { view: this.views_.get(entity)!.value, isNew };
    }

    delete(entity: Entity): boolean {
        const slot = this.slotOf_.get(entity);
        if (slot === undefined) return false;
        // A retained component becomes an ordinary detached value, matching
        // object storage. It must never alias the next owner of this slot.
        const buffer = this.memory_.current?.(this.rows_) ?? this.rows_.buffer;
        if (this.slots_.buffer !== buffer) this.rebuild_();
        this.views_.get(entity)!.detach();
        this.slotOf_.delete(entity);
        this.views_.delete(entity);
        this.refs_?.delete(slot);
        this.mark_(entity, POOL_ABSENT);
        this.owners_[slot] = POOL_NO_OWNER;
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
        // The owner table is indexed by SLOT, so it grows with the rows and on
        // the same schedule — allocated here so one growth is one pair of
        // allocations, and the views below are built once over both.
        let ownerBlock: PoolBlock;
        try { ownerBlock = this.memory_.alloc(want * 4); }
        catch (error) {
            try { this.memory_.release(block); } catch {}
            // The successful allocation may have detached every old heap view.
            try { this.rebuild_(); } catch {}
            throw error;
        }
        // Before reading the old rows, not after: allocating may have grown the
        // heap, and a grown heap detaches the view this is about to copy FROM.
        this.rebuild_();
        const wider = new Float64Array(this.bufferOf_(block), block.byteOffset,
            want * this.fields.length);
        wider.set(this.slots_);
        const widerOwners = new Uint32Array(this.bufferOf_(ownerBlock), ownerBlock.byteOffset, want);
        widerOwners.fill(POOL_NO_OWNER);
        widerOwners.set(this.owners_);
        const old = this.rows_;
        const oldOwners = this.ownersBlock_;
        this.capacity_ = want;
        this.rows_ = block;
        this.slots_ = wider;
        this.ownersBlock_ = ownerBlock;
        this.owners_ = widerOwners;
        disposeAll([old, oldOwners], block => this.memory_.release(block));
        // Views hold a slot index, not a reference into the old array, so they
        // survive this. An ADDRESS taken before it does not, which is why
        // `address` says so.
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
            this.writeValue_(slot, i, base + i, from[f.name]);
        });
    }

    private writeSome_(slot: number, from: Record<string, unknown>): void {
        const base = slot * this.fields.length;
        this.fields.forEach((f, i) => {
            const v = from[f.name];
            if (v !== undefined) this.writeValue_(slot, i, base + i, v);
        });
    }

    private writeValue_(slot: number, index: number, at: number, value: unknown): void {
        this.ensureCurrent_();
        const field = this.fields[index];
        if (typeof value === 'string' && field?.kind === 'number'
            && this.assetRefs_?.fields().some(f => f.field === field.name)) {
            this.refs_ ??= new Map();
            let refs = this.refs_.get(slot);
            if (!refs) {
                this.refs_.set(slot, refs = new Map());
                this.assetRefs_.addressChanged();
            }
            refs.set(index, value);
            this.slots_[at] = 0;
            return;
        }
        const refs = this.refs_?.get(slot);
        if (refs?.delete(index) && refs.size === 0) {
            this.refs_!.delete(slot);
            this.assetRefs_?.addressChanged();
        }
        this.slots_[at] = toSlot(value);
    }

    /** One object per entity, with an accessor per field onto its row. */
    private makeView_(slot: number): PoolView {
        const base = slot * this.fields.length;
        const view: Record<string, unknown> = {};
        let owner: ScriptPool | undefined = this;
        let detached: unknown[] | undefined;
        this.fields.forEach((f, i) => {
            const at = base + i;
            Object.defineProperty(view, f.name, {
                enumerable: true,
                configurable: true,
                get: f.kind === 'boolean'
                    ? (): unknown => {
                        if (!owner) return detached![i];
                        if (owner.slots_.length === 0) owner.rebuild_();
                        return owner.slots_[at] !== 0;
                    }
                    : (): unknown => {
                        if (!owner) return detached![i];
                        if (owner.slots_.length === 0) owner.rebuild_();
                        return owner.refs_?.get(slot)?.get(i) ?? owner.slots_[at]!;
                    },
                set: (v: unknown): void => {
                    if (owner) owner.writeValue_(slot, i, at, v);
                    else detached![i] = v;
                },
            });
        });
        return {
            value: view,
            detach() {
                const pool = owner;
                if (!pool) return;
                // Snapshot canonical columns, without invoking authored getters
                // or redefining properties on sealed/frozen component objects.
                detached = pool.fields.map((f, i) => f.kind === 'boolean'
                    ? pool.slots_[base + i] !== 0
                    : pool.refs_?.get(slot)?.get(i) ?? pool.slots_[base + i]!);
                owner = undefined;
            },
        };
    }
}

/** Placeholders, so the constructor can allocate before it views. */
const EMPTY_F64 = new Float64Array(0);
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_BLOCK: PoolBlock = { buffer: new ArrayBuffer(0), byteOffset: 0, byteLength: 0 };

/** A slot holds a number; a boolean is the 0/1 the ABI stores it as. */
function toSlot(v: unknown): number {
    if (typeof v === 'boolean') return v ? 1 : 0;
    return typeof v === 'number' ? v : 0;
}
