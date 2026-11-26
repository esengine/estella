// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** A declared entity field can hold a single reference or an ordered list, such as a skin's joints. */
export function mapEntityRefField(value: unknown, one: (ref: unknown, index?: number) => unknown): unknown {
    return Array.isArray(value) ? value.map(one) : one(value);
}
