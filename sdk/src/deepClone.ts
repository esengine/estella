// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    deepClone.ts
 * @brief   Structural deep clone for plain data (objects, arrays, primitives)
 */

/**
 * Recursively clone plain objects and arrays; primitives AND class instances
 * (Map, Date, a custom class with methods, …) pass through by reference.
 *
 * Used to materialise per-instance copies of shared default templates (component
 * defaults, resource defaults) so mutating one instance never leaks into the
 * shared definition or a sibling world. Class instances pass through because
 * cloning them into a bare object would strip their prototype (and methods) — a
 * resource whose default is a stateful singleton keeps its identity. Avoids
 * `structuredClone`, which is absent in some minigame runtimes.
 */
export function deepClone<T>(value: T): T {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(deepClone) as T;
    }
    // Only plain objects are cloned; a class instance (non-Object prototype) is
    // shared by reference so its methods survive.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        return value;
    }
    const result: Record<string, unknown> = {};
    for (const key in value) {
        result[key] = deepClone((value as Record<string, unknown>)[key]);
    }
    return result as T;
}
