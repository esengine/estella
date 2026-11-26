// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    deepClone.ts
 * @brief   Structural deep clone for plain data (objects, arrays, primitives)
 */

import { setOwn } from './ownProperties';

/**
 * Recursively clone plain objects and arrays. Class instances retain identity
 * so resources can keep their stateful services.
 * Pass a copy map to preserve repeated references and cycles in plain data.
 */
export function deepClone<T>(value: T, copies?: WeakMap<object, object>): T {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    const cached = copies?.get(value);
    if (cached) return cached as T;
    if (Array.isArray(value)) {
        if (!copies) return value.map(item => deepClone(item)) as T;
        const array: unknown[] = new Array(value.length);
        copies.set(value, array);
        value.forEach((item, i) => { array[i] = deepClone(item, copies); });
        return array as T;
    }
    // Only plain objects are cloned; a class instance (non-Object prototype) is
    // shared by reference so its methods survive.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        return value;
    }
    const result: Record<string, unknown> = {};
    copies?.set(value, result);
    for (const key of Object.keys(value)) {
        setOwn(result, key, deepClone((value as Record<string, unknown>)[key], copies));
    }
    return result as T;
}
