// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    validation.ts
 * @brief   Component data validation utilities
 */

import { hasOwn } from './ownProperties';

type AssetFields = ReadonlySet<string> | readonly { readonly field: string }[];

export type ValidationError = {
    field: string;
    expected: string;
    actual: string;
    value: unknown;
};

export function validateComponentData(
    _componentName: string,
    defaults: Record<string, unknown>,
    data: Record<string, unknown>,
    assetFields?: AssetFields
): ValidationError[] {
    const errors: ValidationError[] = [];
    validateInto(errors, defaults, data, assetFields, '');
    return errors;
}

function validateInto(
    errors: ValidationError[],
    defaults: Record<string, unknown>,
    data: Record<string, unknown>,
    assetFields: AssetFields | undefined,
    prefix: string
): void {
    // Validation walks nested records on both scene load and component writes.
    // Keys avoid allocating a [key, value] tuple for every field at every depth.
    for (const field of Object.keys(data)) {
        const value = data[field];
        if (field.startsWith('_') && field !== '__proto__') continue;
        const path = prefix ? `${prefix}.${field}` : field;
        if (!hasOwn(defaults, field)) {
            // Unknown members are an error only at the TOP level (a stray key names
            // a field that will silently never apply). Nested objects legally carry
            // extra keys — e.g. colors read back from wasm keep ghost x/y/z/w
            // members beside r/g/b/a — so those pass.
            if (!prefix) {
                errors.push({
                    field: path,
                    expected: 'field to exist in component definition',
                    actual: 'unknown field',
                    value,
                });
            }
            continue;
        }

        const defaultValue = defaults[field];
        const expectedType = getType(defaultValue);
        const actualType = getType(value);

        if (expectedType === 'null' || expectedType === 'undefined') continue;
        if (value === null || value === undefined) continue;

        if (expectedType !== actualType) {
            // Asset-ref fields carry two legal shapes: a portable string ref
            // ("@uuid:…", or "" for none) in serialized/model data, and a numeric
            // runtime handle (0 for none). A string↔number mismatch on one denotes
            // the same asset (or its absence), so it is not an error. (Asset refs
            // are top-level fields; the rule never applies at depth.)
            if (
                !prefix &&
                isAssetField(assetFields, field) &&
                ((expectedType === 'string' && actualType === 'number') ||
                    (expectedType === 'number' && actualType === 'string'))
            ) {
                continue;
            }
            errors.push({
                field: path,
                expected: expectedType,
                actual: actualType,
                value,
            });
            continue;
        }

        // Same-shape plain objects: check member TYPES at depth ("size.x" holding
        // a string would otherwise sail through and reach the ABI as garbage).
        // Arrays are type-matched only — element schemas belong to their consumers.
        if (expectedType === 'object') {
            validateInto(
                errors,
                defaultValue as Record<string, unknown>,
                value as Record<string, unknown>,
                undefined,
                path
            );
        }
    }
}

function isAssetField(fields: AssetFields | undefined, name: string): boolean {
    if (!fields) return false;
    if ('has' in fields) return fields.has(name);
    // Component metadata is already a small list. Read it only on a type
    // mismatch, without allocating a Set per write or caching mutable metadata.
    for (const entry of fields) if (entry.field === name) return true;
    return false;
}

/** A component's asset-ref field names — pass to {@link validateComponentData} so
 *  those fields validate leniently: a portable string ref ("@uuid:…"/"") and a
 *  numeric runtime handle (0) both denote the same asset (or its absence). */
export function assetFieldNames(component: { assetFields?: readonly { field: string }[] }): ReadonlySet<string> {
    return new Set((component.assetFields ?? []).map((a) => a.field));
}

function getType(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

export function formatValidationErrors(
    componentName: string,
    errors: ValidationError[]
): string {
    const lines = [`Invalid component data for "${componentName}":`];
    for (const err of errors) {
        lines.push(
            `  - Field "${err.field}": expected ${err.expected}, got ${err.actual} (${JSON.stringify(err.value)})`
        );
    }
    return lines.join('\n');
}
