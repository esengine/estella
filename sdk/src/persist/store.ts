// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    store.ts
 * @brief   Where a server keeps what outlives it. One small asynchronous
 *          document store: a key, a JSON value, and a version that every
 *          write moves on by one. The version is what lets two writers find
 *          out about each other — a write that names the version it read is
 *          refused when someone wrote in between — which is the part a
 *          database adapter has to get right; everything above it is the same
 *          over any store.
 */

/** A stored value and the version it is at (1 after the first write). */
export interface StoredDocument<T = unknown> {
    value: T;
    version: number;
}

export interface PersistWriteOptions {
    /**
     * Only write if the document is at this version now; `0` means only if it
     * does not exist. Omitted, the write goes through whatever is there.
     */
    expectVersion?: number;
}

/** A write refused because the document is not at the version the writer read. */
export class PersistConflict extends Error {
    constructor(readonly key: string, readonly expected: number, readonly actual: number) {
        super(`"${key}" is at version ${actual}, the write expected ${expected}`);
        this.name = 'PersistConflict';
    }
}

/**
 * The store every persistence helper is written against. Values are JSON:
 * what goes in is what a `JSON.stringify` round trip gives back. Implement it
 * over a database to share one store between server processes; give
 * `put`/`delete` with `expectVersion` a real compare-and-set there.
 */
export interface PersistStore {
    get<T = unknown>(key: string): Promise<StoredDocument<T> | null>;
    /** Write and return the new version. Throws {@link PersistConflict} on a version mismatch. */
    put<T = unknown>(key: string, value: T, options?: PersistWriteOptions): Promise<number>;
    /** Remove; returns whether there was anything. Throws {@link PersistConflict} on a version mismatch. */
    delete(key: string, options?: PersistWriteOptions): Promise<boolean>;
    /** Every key starting with `prefix` (all keys without one), in no particular order. */
    keys(prefix?: string): Promise<string[]>;
}

/** Throw the conflict a versioned write owes, if the versions disagree. */
export function checkVersion(key: string, expected: number | undefined, actual: number): void {
    if (expected !== undefined && expected !== actual) throw new PersistConflict(key, expected, actual);
}

/**
 * A store in this process's memory: for tests, and for a server whose state
 * may die with it. Values are kept as JSON text, so a caller mutating what it
 * wrote or read changes nothing stored.
 */
export class MemoryStore implements PersistStore {
    private readonly docs_ = new Map<string, { json: string; version: number }>();

    async get<T = unknown>(key: string): Promise<StoredDocument<T> | null> {
        const doc = this.docs_.get(key);
        return doc ? { value: JSON.parse(doc.json) as T, version: doc.version } : null;
    }

    async put<T = unknown>(key: string, value: T, options: PersistWriteOptions = {}): Promise<number> {
        const current = this.docs_.get(key)?.version ?? 0;
        checkVersion(key, options.expectVersion, current);
        const json = JSON.stringify(value);
        if (json === undefined) throw new Error(`[persist] "${key}": the value is not JSON`);
        this.docs_.set(key, { json, version: current + 1 });
        return current + 1;
    }

    async delete(key: string, options: PersistWriteOptions = {}): Promise<boolean> {
        const current = this.docs_.get(key)?.version ?? 0;
        checkVersion(key, options.expectVersion, current);
        return this.docs_.delete(key);
    }

    async keys(prefix = ''): Promise<string[]> {
        return [...this.docs_.keys()].filter((k) => k.startsWith(prefix));
    }
}
