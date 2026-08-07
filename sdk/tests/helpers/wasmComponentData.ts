// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Component payloads for a direct embind call, built from the component's
 *        own defaults.
 *
 * embind rejects a partial value_object, so anything calling `registry.addX`
 * needs every field the C++ struct declares. Writing them out by hand makes a
 * copy of the struct that nothing updates: the copy goes stale the next time a
 * field is added, `addX` throws at warmup, and vitest SKIPS a bench file that
 * throws while still exiting 0. That has now happened twice — Camera's four
 * viewport scalars becoming one Vec4, and Canvas gaining `layer` — and both
 * times the only thing that noticed was perf-guard's case count.
 *
 * So the defaults come from the registry and the conversion is
 * {@link convertForWasm}, the one BuiltinBridge itself inserts through. Which
 * fields are colors is read off the definition (`colorKeys`), not guessed from
 * the value's shape.
 */
import { convertForWasm } from '../../src/ecs/bridge/BuiltinBridge';

/** A component definition carrying the defaults and the color-field list. */
export interface WasmDataSource {
    readonly _default: unknown;
    readonly colorKeys: readonly string[];
}

/** The component's defaults in the shape embind takes. */
export function wasmData(def: WasmDataSource): Record<string, unknown> {
    return convertForWasm({ ...(def._default as Record<string, unknown>) }, def.colorKeys);
}
