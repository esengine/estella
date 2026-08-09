// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    redact.ts
 * @brief   Marking the values in a diagnostic bundle that belong to the user's
 *          project rather than to the failure.
 *
 * @details An entity's name and a field's value are BOTH what a report needs to
 *          be reproducible and what a studio must not hand out with it. Asking a
 *          section to collect twice — once real, once scrubbed — makes the two
 *          drift on the first edit, so the marking rides on the VALUE: a section
 *          writes `personal(name)` once and the export decides.
 *
 *          Placeholders are stable and derived from the value, so one name is the
 *          same placeholder everywhere it appears. Without that, "deleted X then
 *          undid X" and "deleted X then undid Y" read identically in a report,
 *          which is exactly the distinction a sequence exists to make.
 */

/** A value that identifies the user's project, not the failure. */
export interface Personal<T = unknown> {
    readonly __personal: true;
    readonly value: T;
    /** What the placeholder is called: `name`, `path`, `text`. */
    readonly kind: string;
}

/** How much of the project a bundle carries. */
export type DetailLevel = 'safe' | 'full';

/**
 * Mark a value as the user's, with the noun its placeholder should read as.
 *
 * The kind is not decoration: `path#3f2a` and `name#3f2a` in a report say which
 * kind of thing went missing, and that is often the whole diagnosis.
 */
export function personal<T>(value: T, kind = 'value'): Personal<T> {
    return { __personal: true, value, kind };
}

export function isPersonal(v: unknown): v is Personal {
    return typeof v === 'object' && v !== null && (v as Personal).__personal === true;
}

/**
 * FNV-1a over the value's string form — stable across runs and machines, because
 * a per-session placeholder would make two reports of one bug incomparable.
 *
 * NOT a security boundary: a short hash of a guessed value confirms the guess.
 * It defeats reading a project off a report, not an attacker checking a candidate.
 */
export function stableTag(value: unknown): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0').slice(0, 4);
}

/**
 * What a personal value reads as when it is not carried: its kind, its stable
 * tag, and the SHAPE of what was there — a number that was undefined and a
 * number that was 0 are different bugs, and the shape survives redaction.
 */
export function placeholder(p: Personal): string {
    const v = p.value;
    const tag = `${p.kind}#${stableTag(v)}`;
    if (v === null) return `${p.kind}#null`;
    if (v === undefined) return `${p.kind}#undefined`;
    if (typeof v === 'string') return `${tag}(len=${v.length})`;
    if (typeof v === 'number' || typeof v === 'boolean') return `${p.kind}#${typeof v}`;
    if (Array.isArray(v)) return `${tag}(array,len=${v.length})`;
    return `${tag}(${typeof v})`;
}

/**
 * Resolve every {@link Personal} in a collected tree for the given level. Walks
 * plain objects and arrays only; anything else is replaced by its type name,
 * because a bundle is a document and a live object handed to it would serialize
 * the editor.
 */
export function resolve(value: unknown, level: DetailLevel, seen = new WeakSet<object>()): unknown {
    if (isPersonal(value)) {
        return level === 'full' ? resolve(value.value, level, seen) : placeholder(value);
    }
    if (value === null || typeof value !== 'object') {
        return typeof value === 'function' ? '[function]' : value;
    }
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((v) => resolve(v, level, seen));
    const proto = Object.getPrototypeOf(value) as object | null;
    if (proto !== null && proto !== Object.prototype) return `[${value.constructor?.name ?? 'object'}]`;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolve(v, level, seen);
    return out;
}
