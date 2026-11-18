// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    records.ts
 * @brief   Records of one shape, over a {@link PersistStore}: each is written
 *          with the schema version of its data, and read back through the
 *          migration chain to the current one — the same contract the client
 *          side's `SaveManager` keeps for save slots, here asynchronous and
 *          versioned per write so a stale copy cannot overwrite a newer one.
 */
import { migrateSaveData, type SaveMigration } from '../scene/saveGame';
import type { PersistOp, PersistStore } from './store';

/** What is stored under a record's key. */
export interface RecordEnvelope<T = unknown> {
    /** The schema version `data` was written at. */
    schema: number;
    /** Epoch ms of the write. */
    savedAt: number;
    data: T;
}

export interface RecordBookOptions {
    store: PersistStore;
    /** The current schema version of the data. */
    schema: number;
    /** `migrations[n]` upgrades data written at schema n to n + 1. */
    migrations?: Record<number, SaveMigration>;
    /** Prepended to every key, so several books can share a store. Default none. */
    prefix?: string;
    /** Clock for `savedAt`. Default `Date.now`. */
    now?: () => number;
}

/** A record as read: its data at the current schema, and the store version to write back against. */
export interface LoadedRecord<T> {
    data: T;
    version: number;
    savedAt: number;
}

export class RecordBook<T> {
    readonly store: PersistStore;
    readonly schema: number;
    readonly prefix: string;
    private readonly migrations_: Record<number, SaveMigration>;
    private readonly now_: () => number;

    constructor(options: RecordBookOptions) {
        this.store = options.store;
        this.schema = options.schema;
        this.prefix = options.prefix ?? '';
        this.migrations_ = options.migrations ?? {};
        this.now_ = options.now ?? Date.now;
    }

    /** The record under `key`, migrated to the current schema; null when there is none. */
    async load(key: string): Promise<LoadedRecord<T> | null> {
        const doc = await this.store.get<RecordEnvelope>(this.prefix + key);
        if (!doc) return null;
        const env = doc.value;
        if (!env || typeof env.schema !== 'number') {
            throw new Error(`[persist] "${this.prefix + key}" is not a record`);
        }
        const data = migrateSaveData(env.schema, env.data, this.schema, this.migrations_) as T;
        return { data, version: doc.version, savedAt: env.savedAt };
    }

    /**
     * Write `data` at the current schema and return the new store version.
     * Pass the version it was loaded at (0 for a record that did not exist) and
     * a write that would overwrite someone else's throws `PersistConflict`.
     */
    save(key: string, data: T, expectVersion?: number): Promise<number> {
        const env: RecordEnvelope<T> = { schema: this.schema, savedAt: this.now_(), data };
        return this.store.put(this.prefix + key, env, expectVersion === undefined ? {} : { expectVersion });
    }

    /**
     * Write several records at once, all or none (the store's `transact`). Each
     * names the version it was loaded at; one written meanwhile by someone else
     * fails the lot with `PersistConflict`. Returns the new versions.
     */
    saveMany(records: readonly { key: string; data: T; expectVersion?: number }[]): Promise<number[]> {
        if (!this.store.transact) return Promise.reject(new Error('[persist] this store has no transactions'));
        const savedAt = this.now_();
        const ops: PersistOp[] = records.map((r) => {
            const value: RecordEnvelope<T> = { schema: this.schema, savedAt, data: r.data };
            return r.expectVersion === undefined ? { key: this.prefix + r.key, value } : { key: this.prefix + r.key, value, expectVersion: r.expectVersion };
        });
        return this.store.transact(ops);
    }

    delete(key: string, expectVersion?: number): Promise<boolean> {
        return this.store.delete(this.prefix + key, expectVersion === undefined ? {} : { expectVersion });
    }

    /** Every key in this book, without the prefix. */
    async keys(): Promise<string[]> {
        return (await this.store.keys(this.prefix)).map((k) => k.slice(this.prefix.length));
    }
}
