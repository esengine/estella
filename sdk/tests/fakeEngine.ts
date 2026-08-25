// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fakeEngine.ts
 * @brief   The engine, as far as a compiled module can tell.
 *
 * @details A linear memory and a bump allocator — but shaped like the real one
 *          in the two ways that decide whether a module loads at all, both of
 *          which a plainer fake answers wrongly:
 *
 *          - the memory GROWS. The engine links with `-sALLOW_MEMORY_GROWTH`,
 *            so its memory declares a maximum of 32768 pages. A module that
 *            declares a smaller one does not run slower, it does not
 *            instantiate: `WebAssembly.Instance` throws a LinkError.
 *          - the low addresses are TAKEN. A linker puts a module's data section
 *            at a fixed low address, and for a module sharing this memory that
 *            is on top of the engine's own statics. A fake that leaves those
 *            bytes zero cannot tell an overwrite from a no-op.
 */
import type { WasmHeap } from '../src/ecs/WasmPoolMemory';

/** Where a linker puts a module's data, which is where the engine's statics are. */
const STATICS_AT = 1024;
const STATICS_LEN = 4096;
/** What those bytes hold, so that anything overwriting them is visible. */
const STATICS_BYTE = 0xab;

export class FakeEngine implements WasmHeap {
    /** 256 pages because that is the minimum a built module declares it needs. */
    readonly wasmMemory = new WebAssembly.Memory({ initial: 256, maximum: 32768 });
    HEAPU8 = new Uint8Array(this.wasmMemory.buffer);
    private next = STATICS_AT + STATICS_LEN;

    constructor() { this.statics().fill(STATICS_BYTE); }

    _malloc(size: number): number {
        const at = this.next;
        this.next += (size + 15) & ~15;
        while (this.next > this.HEAPU8.byteLength) {
            this.wasmMemory.grow(1);
            this.HEAPU8 = new Uint8Array(this.wasmMemory.buffer);
        }
        return at;
    }

    _free(): void { /* a bump allocator frees nothing */ }

    /** The bytes the engine owns. Read after loading and after running. */
    statics(): Uint8Array {
        return new Uint8Array(this.wasmMemory.buffer, STATICS_AT, STATICS_LEN);
    }

    /** Whether anything wrote where the engine keeps its own data. */
    staticsIntact(): boolean {
        return this.statics().every((b) => b === STATICS_BYTE);
    }
}
