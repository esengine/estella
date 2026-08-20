// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The engine core a loader can marshal bulk data through.
 *
 * A wasm module carries its heap by construction; a native host answers one from
 * its arena. Both, or neither — a core that has the entry point but no heap has
 * no way to be handed vertices, and saying so here keeps the two loaders that
 * marshal from each open-coding the same four checks.
 */
import type { EngineApi } from '../../ecs/bridge/engineApi';
import type { NativeHeap } from '../../ecs/bridge/nativeHeap';

/** An engine core with the heap its bulk entry points read from. */
export type MarshallingCore = EngineApi & NativeHeap;

/** `api` when it can marshal, else null. */
export function marshallingCore(api: EngineApi | null): MarshallingCore | null {
    return api?._malloc && api._free && api.HEAPU8 && api.HEAPF32
        ? (api as MarshallingCore)
        : null;
}
