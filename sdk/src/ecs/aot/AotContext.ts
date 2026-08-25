// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotContext.ts
 * @brief   The host half of the ABI, in the language that owns the maps.
 *
 * @details docs/REARCH_AOT_ABI.md §2.1 gives the host four jobs: pack the rows,
 *          resolve the resource addresses, ready the command buffer, and fill a
 *          SysCtx. On web that host is TypeScript rather than C++, and not by
 *          preference — the query's candidate set and the script pools' slot
 *          maps are both here, so anything else would have to call back across
 *          the boundary once per entity per frame, which is the cost AOT exists
 *          to remove.
 *
 *          Everything it writes goes into the ENGINE's linear memory, because
 *          that is where the compiled code reads. The arena is rebuilt per call:
 *          §2.2 gives a row array a one-call lifetime, and reusing the block
 *          rather than the contents is what keeps that free.
 */

import type { PoolBlock, PoolMemory } from '../ScriptPool';
import { CMD_WORDS, QUERYROWS_WORDS, SYSCTX_WORDS } from './abiDigest';

// The struct sizes and the command kinds have one author, and it is not this
// file: `abiDigest.ts`, which the compiler reads too. Re-exported so call sites
// name the ABI rather than the digest.
export {
    SYSCTX_WORDS, QUERYROWS_WORDS, CMD_WORDS, CMD_DESPAWN, CMD_REMOVE,
} from './abiDigest';

/** One record the compiled code appended (§2.3). */
export interface AotCommand {
    readonly kind: number;
    readonly a: number;
}

/** A row: the entity, then one address per component the query names. */
export type AotRow = readonly number[];

/**
 * The per-call scratch, in engine memory. One instance per system is enough —
 * a call is over before the next begins, and §2.2 says nothing may outlive it.
 */
export class AotContext {
    private block: PoolBlock | null = null;
    private words: Uint32Array = EMPTY;
    private cmdCap: number;

    constructor(private readonly memory: PoolMemory, cmdCap = 256) {
        this.cmdCap = cmdCap;
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
     * `queries[k]` is the rows of the k-th declared Query, in the order the
     * system will walk them; `resources[j]` is the address of the j-th declared
     * Res. Both are the caller's because both come from maps the caller owns.
     */
    build(queries: readonly (readonly AotRow[])[], resources: readonly number[]): number {
        const rowWords = queries.reduce(
            (n, rows) => n + rows.reduce((m, r) => m + r.length, 0), 0);
        const need = SYSCTX_WORDS
            + queries.length * QUERYROWS_WORDS
            + rowWords
            + resources.length
            + 1                              // the count, which the code writes back
            + this.cmdCap * CMD_WORDS;
        this.reserve_(need);

        const base = this.block!.byteOffset;
        const w = this.words;
        // Laid out in one pass, each table after the last, so the addresses are
        // known before anything that points at them is written.
        let at = SYSCTX_WORDS;
        const queryTable = at;
        at += queries.length * QUERYROWS_WORDS;
        const rowsAt: number[] = [];
        for (const rows of queries) {
            rowsAt.push(at);
            for (const row of rows) {
                for (const v of row) w[at++] = v;
            }
        }
        const resTable = at;
        for (const r of resources) w[at++] = r;
        const countAt = at++;
        w[countAt] = 0;
        const cmdBuf = at;

        queries.forEach((rows, k) => {
            const slot = queryTable + k * QUERYROWS_WORDS;
            w[slot] = base + rowsAt[k]! * 4;
            w[slot + 1] = rows.length;
        });
        w[0] = base + queryTable * 4;
        w[1] = base + resTable * 4;
        w[2] = base + cmdBuf * 4;
        w[3] = this.cmdCap;
        w[4] = base + countAt * 4;
        w[5] = 0;                            // events: no channel carries one yet
        this.countAt_ = countAt;
        this.cmdAt_ = cmdBuf;
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

    private countAt_ = 0;
    private cmdAt_ = 0;
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
