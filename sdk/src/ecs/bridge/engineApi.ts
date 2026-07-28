// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ecs/engineApi.ts
 * @brief   Whichever engine core is present, by one set of names.
 *
 * A plugin that drives the engine — UI layout, hit testing, render order — used
 * to reach it as `app.wasmModule.uiLayout_update(...)`, which is a statement
 * about HOW the core is embedded, not about what the plugin wants. On a device
 * there is no wasm module, so every such plugin was web-only by construction.
 *
 * `engineApi(app)` answers with the module on the web and with the native host's
 * bindings on a device. Both spell the entry points the same way, because both
 * come from the same C++ declarations: embind registers them for the module, and
 * EHT generates the native side (see nativeEngineApi.generated.ts).
 *
 * Members are optional — a core answers what it compiles — so call sites read
 * `api.uiLayout_update?.(…)`, which is also how they treat an engine build that
 * left a subsystem out.
 */

import type { App } from '../../app/app';
import type { NativeEngineApi } from './nativeEngineApi.generated';
import type { NativeHeap } from './nativeHeap';

/**
 * The engine surface a plugin may call, from either core: the entry points plus
 * the heap they marshal bulk data through. A wasm module answers both by
 * construction; a native host answers the heap from its arena (see nativeHeap.ts),
 * so a plugin that writes a tile array and passes an offset works on both.
 */
export type EngineApi = NativeEngineApi & Partial<NativeHeap>;

let native_: EngineApi | null = null;

/** Install the native host's engine API (by the native runtime); null clears it. */
export function setNativeEngineApi(api: EngineApi | null): void {
    native_ = api;
}

/**
 * The engine entry points for this app: the wasm module when there is one, else
 * the native host's bindings. Null only when neither exists (a pure logic host),
 * which every call site already handles by optional-chaining its call.
 */
export function engineApi(app: App): EngineApi | null {
    return (app.wasmModule as EngineApi | null) ?? native_;
}

/**
 * The native host's engine API, for the few callers that sit BELOW an App — the
 * World, which on a device has a registry but no wasm module to reach the engine
 * through. Null on the web (where the module is the answer) and on a logic host.
 */
export function nativeEngineApi(): EngineApi | null {
    return native_;
}
