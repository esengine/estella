// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    directory.ts
 * @brief   Which zone servers are up, where to reach them, and how full they
 *          are. Every zone writes its own entry on a heartbeat; anyone reads the
 *          list. An entry not refreshed within its time to live is a zone that
 *          is gone — no process has to say so, which is what a crash cannot.
 *
 *          Kept in a {@link PersistStore}, so a store shared between machines
 *          (a database adapter) is a directory shared between them.
 */
import type { PersistStore } from '../persist/store';

/** One zone as it describes itself. */
export interface ZoneInfo {
    /** Unique among zones: `'forest'`, `'forest#2'`, `'dungeon-7f3a'`. */
    id: string;
    /** What a client dials to reach it. */
    address: string;
    /** Free-form grouping: a map name, a line of a map, an instance kind. */
    kind?: string;
    /** Players it holds now. */
    players: number;
    /** Most players it takes; `pick` skips a full zone. */
    capacity?: number;
    /** Epoch ms of its last heartbeat. */
    seenAt: number;
}

export interface ZoneDirectoryOptions {
    store: PersistStore;
    /** A zone not heard from for this long is gone. Default 15 s. */
    ttlMs?: number;
    /** Key prefix in the store. Default `zone:`. */
    prefix?: string;
    now?: () => number;
}

export class ZoneDirectory {
    private readonly store_: PersistStore;
    private readonly ttlMs_: number;
    private readonly prefix_: string;
    private readonly now_: () => number;

    constructor(options: ZoneDirectoryOptions) {
        this.store_ = options.store;
        this.ttlMs_ = options.ttlMs ?? 15_000;
        this.prefix_ = options.prefix ?? 'zone:';
        this.now_ = options.now ?? Date.now;
    }

    get ttlMs(): number {
        return this.ttlMs_;
    }

    /** Write (or refresh) a zone's entry. Call on a heartbeat well inside the time to live. */
    async announce(zone: Omit<ZoneInfo, 'seenAt'>): Promise<void> {
        await this.store_.put<ZoneInfo>(this.prefix_ + zone.id, { ...zone, seenAt: this.now_() });
    }

    /** Take a zone's entry away now, for a clean shutdown. */
    async withdraw(zoneId: string): Promise<void> {
        await this.store_.delete(this.prefix_ + zoneId);
    }

    /**
     * One live zone, or null when it is unknown or has gone quiet. `maxAgeMs`
     * asks for a tighter bound than the time to live — a zone about to be
     * trusted with a player should have been heard from very recently.
     */
    async get(zoneId: string, maxAgeMs = this.ttlMs_): Promise<ZoneInfo | null> {
        const doc = await this.store_.get<ZoneInfo>(this.prefix_ + zoneId);
        if (!doc || this.now_() - doc.value.seenAt > Math.min(maxAgeMs, this.ttlMs_)) return null;
        return doc.value;
    }

    /** Every live zone, of one `kind` when given; `maxAgeMs` asks for a tighter bound than the time to live. */
    async list(kind?: string, maxAgeMs = this.ttlMs_): Promise<ZoneInfo[]> {
        const out: ZoneInfo[] = [];
        const now = this.now_();
        const age = Math.min(maxAgeMs, this.ttlMs_);
        for (const key of await this.store_.keys(this.prefix_)) {
            const doc = await this.store_.get<ZoneInfo>(key);
            if (!doc || now - doc.value.seenAt > age) continue;
            if (kind !== undefined && doc.value.kind !== kind) continue;
            out.push(doc.value);
        }
        return out;
    }

    /**
     * The live zone of `kind` with the most room — the line of a map a newcomer
     * is put on. Null when every one is full or none is up.
     */
    async pick(kind: string, maxAgeMs = this.ttlMs_): Promise<ZoneInfo | null> {
        let best: ZoneInfo | null = null;
        for (const z of await this.list(kind, maxAgeMs)) {
            if (z.capacity !== undefined && z.players >= z.capacity) continue;
            const room = (z.capacity ?? Infinity) - z.players;
            const bestRoom = best ? (best.capacity ?? Infinity) - best.players : -Infinity;
            if (!best || room > bestRoom || (room === bestRoom && z.players < best.players)) best = z;
        }
        return best;
    }
}
