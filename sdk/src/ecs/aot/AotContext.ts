// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotContext.ts
 * @brief   The host half of the ABI, in the language that owns the maps.
 *
 * @details The ABI gives the host four jobs: pack the rows, resolve the resource
 *          addresses, ready the command buffer, and fill a SysCtx. On web that host is TypeScript rather than C++, and not by
 *          preference — the query's candidate set and the script pools' slot
 *          maps are both here, so anything else would have to call back across
 *          the boundary once per entity per frame, which is the cost AOT exists
 *          to remove.
 *
 *          Everything it writes goes into the ENGINE's linear memory, because
 *          that is where the compiled code reads. The arena is rebuilt per call:
 *          a row array has a one-call lifetime, and reusing the block rather
 *          than the contents is what keeps that free.
 */

import type { PoolBlock, PoolMemory } from '../ScriptPool';
import { CMD_WORDS, EVENT_OUT_WORDS, QUERYROWS_WORDS, SYSCTX_WORDS } from './abiDigest';

// The struct sizes and the command kinds have one author, and it is not this
// file: `abiDigest.ts`, which the compiler reads too. Re-exported so call sites
// name the ABI rather than the digest.
export {
    SYSCTX_WORDS, QUERYROWS_WORDS, CMD_WORDS, EVENT_OUT_WORDS, CMD_DESPAWN, CMD_REMOVE,
} from './abiDigest';

/** One record the compiled code appended. */
export interface AotCommand {
    readonly kind: number;
    readonly a: number;
}

/**
 * The per-call scratch, in engine memory. One instance per system is enough —
 * a call is over before the next begins, and nothing may outlive it.
 */
export class AotContext {
    private block: PoolBlock | null = null;
    private words: Uint32Array = EMPTY;
    private cmdCap: number;
    /** f64 slots a call may append across every writer it declared. */
    private eventCap: number;

    constructor(private readonly memory: PoolMemory, cmdCap = 256, eventCap = 512) {
        this.cmdCap = cmdCap;
        this.eventCap = eventCap;
    }

    /** Hand the block back; the arena is dead after this. */
    dispose(): void {
        if (this.block) this.memory.release(this.block);
        this.block = null;
        this.words = EMPTY;
    }

    /**
     * Lay out one call and answer the ctx address.
     *
     * The rows arrive packed — every query's, back to back, in query order —
     * because the caller wrote them there as it walked. `offsets[k]`/`counts[k]`
     * locate the k-th Query's; `resources[j]` is the j-th Res. One `set` copies
     * the block, where a row at a time was a word at a time (bench/aot-frame).
     */
    build(
        rows: Uint32Array,
        rowWords: number,
        offsets: Uint32Array,
        counts: Uint32Array,
        resources: readonly number[],
    ): number {
        const queryCount = counts.length;
        const need = SYSCTX_WORDS
            + queryCount * QUERYROWS_WORDS
            + rowWords
            + resources.length
            + 1                              // the count, which the code writes back
            + this.cmdCap * CMD_WORDS
            + EVENT_OUT_WORDS + 1 + this.eventCap * 2;   // f64 slots are two words
        this.reserve_(need);

        const base = this.block!.byteOffset;
        const w = this.words;
        // Laid out in one pass, each table after the last, so the addresses are
        // known before anything that points at them is written.
        const queryTable = SYSCTX_WORDS;
        const rowsAt = queryTable + queryCount * QUERYROWS_WORDS;
        w.set(rows.subarray(0, rowWords), rowsAt);
        let at = rowsAt + rowWords;
        const resTable = at;
        for (const r of resources) w[at++] = r;
        const countAt = at++;
        w[countAt] = 0;
        const cmdBuf = at;

        for (let k = 0; k < queryCount; k++) {
            const slot = queryTable + k * QUERYROWS_WORDS;
            w[slot] = base + (rowsAt + offsets[k]!) * 4;
            w[slot + 1] = counts[k]!;
        }
        // The event queue: a header of three addresses, its own used-count, and
        // the f64 records themselves. A system that writes none still gets a
        // valid header, because the code reads it before it knows.
        let evAt = cmdBuf + this.cmdCap * CMD_WORDS;
        const evHeader = evAt;
        evAt += EVENT_OUT_WORDS;
        const evCountAt = evAt++;
        w[evCountAt] = 0;
        const evBuf = (evAt + 1) & ~1;       // an f64 record starts 8-aligned
        w[evHeader] = base + evBuf * 4;
        w[evHeader + 1] = this.eventCap * 2;
        w[evHeader + 2] = base + evCountAt * 4;

        w[0] = base + queryTable * 4;
        w[1] = base + resTable * 4;
        w[2] = base + cmdBuf * 4;
        w[3] = this.cmdCap;
        w[4] = base + countAt * 4;
        w[5] = base + evHeader * 4;
        this.countAt_ = countAt;
        this.cmdAt_ = cmdBuf;
        this.evCountAt_ = evCountAt;
        this.evBufAt_ = evBuf;
        this.address_ = base;
        return base;
    }

    /** What the call appended. Valid until the next `build`. */
    commands(): AotCommand[] {
        if (this.block === null) return [];
        const w = this.view_();
        const n = w[this.countAt_]!;
        const out: AotCommand[] = [];
        for (let i = 0; i < n; i++) {
            const at = this.cmdAt_ + i * CMD_WORDS;
            out.push({ kind: w[at]!, a: w[at + 1]! });
        }
        return out;
    }

    /**
     * What the call SENT: each record is a writer slot then its fields, in the
     * order the manifest declares. Valid until the next `build`.
     */
    events(): { slot: number; fields: readonly number[] }[] {
        if (this.block === null) return [];
        const w = this.view_();
        const used = w[this.evCountAt_]!;
        const f64 = new Float64Array(w.buffer, w.byteOffset + this.evBufAt_ * 4,
            Math.max(0, Math.floor((w.byteLength - this.evBufAt_ * 4) / 8)));
        const out: { slot: number; fields: readonly number[] }[] = [];
        // Records are variable length, so the reader has to be told how long
        // each one is; the caller knows, from what it declared.
        for (let i = 0; i < used;) {
            const slot = f64[i]!;
            const len = this.lengthOf_(slot);
            out.push({ slot, fields: [...f64.subarray(i + 1, i + len)] });
            i += len;
        }
        return out;
    }

    /** How long one writer's record is, set by the caller before the call. */
    setRecordLengths(lengths: readonly number[]): void {
        this.lengths_ = lengths;
    }

    private lengthOf_(slot: number): number {
        return (this.lengths_[slot] ?? 0) + 1;
    }

    private lengths_: readonly number[] = [];
    private countAt_ = 0;
    private cmdAt_ = 0;
    private evCountAt_ = 0;
    private evBufAt_ = 0;
    private address_ = 0;

    /** The ctx `build` last laid out. */
    get address(): number {
        return this.address_;
    }

    private reserve_(words: number): void {
        if (this.block !== null && words * 4 <= this.block.byteLength) {
            this.words = this.view_();
            return;
        }
        const want = Math.max(words * 4 * 2, 1024);
        const block = this.memory.alloc(want);
        // After the allocation, never before: growing the heap detaches every
        // view of it, including the one this is about to replace.
        const old = this.block;
        this.block = block;
        this.words = this.view_();
        if (old) this.memory.release(old);
    }

    /** The words of this arena, over whatever buffer the heap is in now. */
    private view_(): Uint32Array {
        const block = this.block!;
        const buffer = this.memory.current?.(block) ?? block.buffer;
        return new Uint32Array(buffer, block.byteOffset, block.byteLength >> 2);
    }
}

const EMPTY = new Uint32Array(0);
