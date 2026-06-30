// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    saveGame.ts
 * @brief   Versioned save/load with migration, over the Storage API. A save is a
 *          `{ version, data, savedAt }` envelope; on load, older saves are run
 *          forward through a migration chain to the current version — so a
 *          shipped game can evolve its save shape without bricking old saves.
 */

import { Storage } from './storage';

export interface SaveEnvelope<T> {
    /** Schema version the `data` was written at. */
    version: number;
    data: T;
    /** Epoch ms the save was written. */
    savedAt: number;
}

/** Migrates save data from version N to N+1. Keyed by the source version N. */
export type SaveMigration = (data: unknown) => unknown;

/**
 * Bring `data` (written at `version`) forward to `currentVersion` by applying
 * `migrations[version]`, `migrations[version+1]`, … in order. Pure.
 * Throws if the save is newer than current (no downgrade) or a step is missing.
 */
export function migrateSaveData(
    version: number,
    data: unknown,
    currentVersion: number,
    migrations: Record<number, SaveMigration>,
): unknown {
    if (version > currentVersion) {
        throw new Error(`save version ${version} is newer than the current version ${currentVersion}`);
    }
    let d = data;
    for (let v = version; v < currentVersion; v++) {
        const step = migrations[v];
        if (!step) throw new Error(`missing save migration for version ${v} -> ${v + 1}`);
        d = step(d);
    }
    return d;
}

/** The slice of the Storage API SaveManager needs (injectable for tests). */
export interface SaveStorage {
    getJSON<T>(key: string, defaultValue?: T): T | undefined;
    setJSON<T>(key: string, value: T): void;
    remove(key: string): void;
    has(key: string): boolean;
}

export interface SaveManagerOptions {
    /** Current save schema version. */
    version: number;
    /** Migration chain; `migrations[n]` upgrades version n → n+1. */
    migrations?: Record<number, SaveMigration>;
    /** Storage backend (defaults to the engine's Storage). */
    storage?: SaveStorage;
    /** Clock for `savedAt` (defaults to Date.now); inject for deterministic tests. */
    now?: () => number;
    /** Key prefix for slots (defaults to `save:`). */
    keyPrefix?: string;
}

/**
 * Named save slots with schema versioning + migration. `save(slot, data)` stamps
 * the current version; `load(slot)` migrates an older save forward and returns
 * its data (or null when the slot is empty / unreadable).
 */
export class SaveManager {
    private readonly version: number;
    private readonly migrations: Record<number, SaveMigration>;
    private readonly storage: SaveStorage;
    private readonly now: () => number;
    private readonly prefix: string;

    constructor(opts: SaveManagerOptions) {
        this.version = opts.version;
        this.migrations = opts.migrations ?? {};
        this.storage = opts.storage ?? Storage;
        this.now = opts.now ?? (() => Date.now());
        this.prefix = opts.keyPrefix ?? 'save:';
    }

    save<T>(slot: string, data: T): void {
        const env: SaveEnvelope<T> = { version: this.version, data, savedAt: this.now() };
        this.storage.setJSON(this.key_(slot), env);
    }

    /** Load + migrate a slot's data, or null if empty/unreadable. */
    load<T>(slot: string): T | null {
        const env = this.storage.getJSON<SaveEnvelope<unknown>>(this.key_(slot));
        if (!env || typeof env.version !== 'number') return null;
        return migrateSaveData(env.version, env.data, this.version, this.migrations) as T;
    }

    has(slot: string): boolean {
        return this.storage.has(this.key_(slot));
    }

    remove(slot: string): void {
        this.storage.remove(this.key_(slot));
    }

    /** When the slot was written (epoch ms), or null if empty. */
    savedAt(slot: string): number | null {
        const env = this.storage.getJSON<SaveEnvelope<unknown>>(this.key_(slot));
        return env && typeof env.savedAt === 'number' ? env.savedAt : null;
    }

    private key_(slot: string): string {
        return this.prefix + slot;
    }
}
