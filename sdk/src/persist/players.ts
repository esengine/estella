// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    players.ts
 * @brief   Each present player's record, loaded when they arrive and written
 *          back when they leave, on a timer while they stay, and on shutdown.
 *
 *          It is driven the way the replication server is read: hand it the
 *          players present now, every tick, and it starts loading the new ones
 *          and saves and lets go of the ones that left. Nothing here knows what
 *          a record holds — the game's data, an entity snapshot, both.
 *
 *          Writes to one player happen in order, and a load waits for that
 *          player's write still in flight: a player who leaves and comes
 *          straight back reads what they left with, not what they had before.
 *          A write names the version it read, so a record someone else wrote
 *          in between (another server process) is never overwritten: the
 *          write fails with `PersistConflict` and `onError` hears about it.
 */
import type { SaveMigration } from '../scene/saveGame';
import { RecordBook } from './records';
import type { PersistStore } from './store';

export interface PlayerPersistenceOptions<T> {
    store: PersistStore;
    /** Current schema version of the record. */
    schema: number;
    /** `migrations[n]` upgrades a record written at schema n to n + 1. */
    migrations?: Record<number, SaveMigration>;
    /** The record a player who has none starts with. */
    create(playerId: string): T;
    /** Key prefix in the store. Default `player:`. */
    prefix?: string;
    /** Write changed records this often while their players stay. Default 60 s; 0 turns it off. */
    autosaveMs?: number;
    /** Wait this long before loading a player again after a failed load. Default 2 s. */
    retryMs?: number;
    /** A load or save that failed. The record stays in memory; a conflict means someone else's write is newer. */
    onError?(playerId: string, error: unknown, during: 'load' | 'save'): void;
    /** Clock. Default `Date.now`. */
    now?: () => number;
}

interface Entry<T> {
    state: 'loading' | 'ready' | 'failed';
    data: T | undefined;
    /** Store version the record was read or last written at; 0 for none yet. */
    version: number;
    dirty: boolean;
    retryAt: number;
}

export class PlayerPersistence<T> {
    private readonly book_: RecordBook<T>;
    private readonly options_: PlayerPersistenceOptions<T>;
    private readonly entries_ = new Map<string, Entry<T>>();
    /** Each player's queue of store operations, so they run in order. */
    private readonly queue_ = new Map<string, Promise<void>>();
    private readonly now_: () => number;
    private nextAutosave_: number;
    /** Running totals for monitoring (`esengine/metrics` reads them on a scrape). */
    readonly stats = { loads: 0, loadErrors: 0, saves: 0, saveErrors: 0, conflicts: 0 };
    private inFlight_ = 0;

    constructor(options: PlayerPersistenceOptions<T>) {
        this.options_ = options;
        this.book_ = new RecordBook<T>({
            store: options.store, schema: options.schema, migrations: options.migrations,
            prefix: options.prefix ?? 'player:', now: options.now,
        });
        this.now_ = options.now ?? Date.now;
        this.nextAutosave_ = this.now_() + this.autosaveMs_;
    }

    private get autosaveMs_(): number {
        return this.options_.autosaveMs ?? 60_000;
    }

    /** Store operations started and not yet finished. */
    get pendingOperations(): number {
        return this.inFlight_;
    }

    /**
     * The players present now. Newcomers start loading; players no longer in
     * the list are written back (if changed) and let go; a due autosave starts.
     * Call it every tick — it returns at once and never waits on the store.
     */
    track(playerIds: Iterable<string>): void {
        const present = new Set(playerIds);
        const now = this.now_();
        for (const id of present) {
            const entry = this.entries_.get(id);
            if (!entry) this.startLoad_(id);
            else if (entry.state === 'failed' && now >= entry.retryAt) this.startLoad_(id);
        }
        for (const id of [...this.entries_.keys()]) {
            if (!present.has(id)) this.release(id);
        }
        if (this.autosaveMs_ > 0 && now >= this.nextAutosave_) {
            this.nextAutosave_ = now + this.autosaveMs_;
            for (const [id, entry] of this.entries_) if (entry.dirty) void this.save(id);
        }
    }

    /** Whether the player's record is loaded and theirs to read and change. */
    isReady(playerId: string): boolean {
        return this.entries_.get(playerId)?.state === 'ready';
    }

    /** The player's record, once ready. Change it in place and call {@link markDirty}, or replace it with {@link set}. */
    get(playerId: string): T | undefined {
        const entry = this.entries_.get(playerId);
        return entry?.state === 'ready' ? entry.data : undefined;
    }

    /** Replace a ready player's record. */
    set(playerId: string, data: T): void {
        const entry = this.requireReady_(playerId);
        entry.data = data;
        entry.dirty = true;
    }

    /** Say a ready player's record changed, so the next save writes it. */
    markDirty(playerId: string): void {
        this.requireReady_(playerId).dirty = true;
    }

    /** Write the player's record now if it changed. Resolves when it is stored (or failed; see `onError`). */
    save(playerId: string): Promise<void> {
        const entry = this.entries_.get(playerId);
        if (!entry || entry.state !== 'ready' || !entry.dirty) return this.queue_.get(playerId) ?? Promise.resolve();
        return this.enqueueWrite_(playerId, entry);
    }

    /** Write the player's record if it changed and stop holding it. Resolves when the write is done. */
    release(playerId: string): Promise<void> {
        const entry = this.entries_.get(playerId);
        if (!entry) return this.queue_.get(playerId) ?? Promise.resolve();
        this.entries_.delete(playerId);
        if (entry.state === 'ready' && entry.dirty) return this.enqueueWrite_(playerId, entry);
        return this.queue_.get(playerId) ?? Promise.resolve();
    }

    /** Write every changed record and wait for every store operation started so far. For shutdown. */
    async flush(): Promise<void> {
        for (const [id, entry] of this.entries_) if (entry.dirty && entry.state === 'ready') void this.save(id);
        await Promise.all([...this.queue_.values()]);
    }

    // -- internals ------------------------------------------------------------

    private requireReady_(playerId: string): Entry<T> {
        const entry = this.entries_.get(playerId);
        if (entry?.state !== 'ready') throw new Error(`[persist] player "${playerId}" is not loaded`);
        return entry;
    }

    /**
     * Write several players' records as one: all of them, or none. For what
     * must not half-happen — a trade between two players, a gift that leaves
     * one inventory for another. Each record is written as it is now, against
     * the version it was loaded at; if anyone else wrote one of them meanwhile,
     * nothing is written and this rejects with `PersistConflict` (the records
     * stay changed in memory and dirty, for the game to undo or retry). Every
     * player must be loaded here, and the store must do transactions.
     */
    saveTogether(playerIds: readonly string[]): Promise<void> {
        const entries = playerIds.map((id) => this.requireReady_(id));
        const datas = entries.map((e) => e.data as T);
        for (const e of entries) e.dirty = false;
        return this.enqueueMany_(playerIds, async () => {
            try {
                const versions = await this.book_.saveMany(playerIds.map((id, i) => ({
                    key: id, data: datas[i]!, expectVersion: entries[i]!.version,
                })));
                versions.forEach((v, i) => { entries[i]!.version = v; });
            } catch (err) {
                for (const e of entries) e.dirty = true;
                throw err;
            }
        });
    }

    /** Run `op` after every one of these players' queued operations, holding them all until it is done. */
    private enqueueMany_(playerIds: readonly string[], op: () => Promise<void>): Promise<void> {
        this.inFlight_++;
        const prev = Promise.all(playerIds.map((id) => (this.queue_.get(id) ?? Promise.resolve()).catch(() => undefined)));
        const next = prev.then(op).finally(() => {
            this.inFlight_--;
            for (const id of playerIds) if (this.queue_.get(id) === tail) this.queue_.delete(id);
        });
        const tail = next.catch(() => undefined);
        for (const id of playerIds) this.queue_.set(id, tail);
        return next;
    }

    private enqueue_(playerId: string, op: () => Promise<void>): Promise<void> {
        this.inFlight_++;
        const prev = this.queue_.get(playerId) ?? Promise.resolve();
        const next = prev.then(op).finally(() => {
            this.inFlight_--;
            if (this.queue_.get(playerId) === next) this.queue_.delete(playerId);
        });
        this.queue_.set(playerId, next);
        return next;
    }

    private startLoad_(playerId: string): void {
        const entry: Entry<T> = { state: 'loading', data: undefined, version: 0, dirty: false, retryAt: 0 };
        this.entries_.set(playerId, entry);
        void this.enqueue_(playerId, async () => {
            try {
                const loaded = await this.book_.load(playerId);
                this.stats.loads++;
                if (this.entries_.get(playerId) !== entry) return; // left while loading
                if (loaded) {
                    entry.data = loaded.data;
                    entry.version = loaded.version;
                } else {
                    entry.data = this.options_.create(playerId);
                    entry.version = 0;
                    // A new player is written on their first save even if nothing changed.
                    entry.dirty = true;
                }
                entry.state = 'ready';
            } catch (err) {
                if (this.entries_.get(playerId) !== entry) return;
                this.stats.loadErrors++;
                entry.state = 'failed';
                entry.retryAt = this.now_() + (this.options_.retryMs ?? 2000);
                this.options_.onError?.(playerId, err, 'load');
            }
        });
    }

    private enqueueWrite_(playerId: string, entry: Entry<T>): Promise<void> {
        // What is written is the record as it is NOW; a change made while the
        // write is in flight marks it dirty again for the next one.
        const data = entry.data as T;
        entry.dirty = false;
        return this.enqueue_(playerId, async () => {
            try {
                entry.version = await this.book_.save(playerId, data, entry.version);
                this.stats.saves++;
            } catch (err) {
                this.stats.saveErrors++;
                if ((err as { name?: string })?.name === 'PersistConflict') this.stats.conflicts++;
                entry.dirty = true;
                this.options_.onError?.(playerId, err, 'save');
            }
        });
    }
}
