// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    leases.ts
 * @brief   Which zone a player is in, as one fact every zone agrees on. A zone
 *          holds a player's lease while the player is there, renews it while
 *          they stay, and gives it up — or hands it to another zone — when
 *          they leave. Everything is a versioned write, so two zones racing for
 *          one player cannot both win, and a lease nobody renews runs out: a
 *          zone that crashes frees its players after `ttlMs`, or sooner when
 *          another zone sees it has stopped heartbeating and takes them over.
 *
 *          A released lease is kept, expired, as where the player was last:
 *          the zone and its kind are what a login is routed by.
 *
 *          Clocks matter here: expiry compares a holder's write time against
 *          the reader's clock, so zones that share leases need clocks within a
 *          small fraction of `ttlMs` of each other (NTP does this).
 */
import { PersistConflict, type PersistStore } from '../persist/store';

export interface PlayerLease {
    playerId: string;
    zoneId: string;
    /** The holding zone's kind, kept so a login can be sent to another zone of it. */
    kind?: string;
    /** Epoch ms after which the lease is free if not renewed; 0 once released. */
    until: number;
    /**
     * Handed to `zoneId` by `from` and not taken up yet: the player is on the
     * way. If they turn up at `from` again instead, they never arrived, and
     * `from` may take them back.
     */
    arriving?: boolean;
    from?: string;
}

export interface PlayerLeasesOptions {
    store: PersistStore;
    /** How long a lease lasts without renewal. Default 30 s. */
    ttlMs?: number;
    /** Key prefix in the store. Default `lease:`. */
    prefix?: string;
    now?: () => number;
}

/** Why a lease could not be taken: another zone holds it. */
export class LeaseHeld extends Error {
    constructor(readonly playerId: string, readonly heldBy: string, readonly until: number) {
        super(`player "${playerId}" is in zone "${heldBy}"`);
        this.name = 'LeaseHeld';
    }
}

export class PlayerLeases {
    private readonly store_: PersistStore;
    private readonly ttlMs_: number;
    private readonly prefix_: string;
    private readonly now_: () => number;

    constructor(options: PlayerLeasesOptions) {
        this.store_ = options.store;
        this.ttlMs_ = options.ttlMs ?? 30_000;
        this.prefix_ = options.prefix ?? 'lease:';
        this.now_ = options.now ?? Date.now;
    }

    get ttlMs(): number {
        return this.ttlMs_;
    }

    /** The lease as it stands; null when nobody holds a live one. */
    async get(playerId: string): Promise<PlayerLease | null> {
        const lease = await this.last(playerId);
        return lease && lease.until > this.now_() ? lease : null;
    }

    /** The last lease the player had, live or not: where they were last. Null for a player never seen. */
    async last(playerId: string): Promise<PlayerLease | null> {
        const doc = await this.store_.get<PlayerLease>(this.prefix_ + playerId);
        return doc?.value ?? null;
    }

    /**
     * Take (or keep) the player for `zoneId`. Succeeds when the lease is free,
     * expired, or already this zone's; throws {@link LeaseHeld} when another
     * zone holds a live one.
     */
    acquire(playerId: string, zoneId: string, kind?: string): Promise<PlayerLease> {
        return this.write_(playerId, (current) => {
            if (current && current.zoneId !== zoneId && current.until > this.now_()) {
                throw new LeaseHeld(playerId, current.zoneId, current.until);
            }
            return { zoneId, kind };
        });
    }

    /** Extend a lease this zone holds. Throws {@link LeaseHeld} if it was lost to another zone. */
    renew(playerId: string, zoneId: string, kind?: string): Promise<PlayerLease> {
        return this.acquire(playerId, zoneId, kind);
    }

    /**
     * Take the player from `fromZone` whatever its lease says — for a zone that
     * has stopped heartbeating and will not release them. Only if `fromZone`
     * still holds them (a versioned write): if anyone else took them meanwhile,
     * {@link LeaseHeld}. Should the old zone come back, its next renewal finds
     * the lease gone and lets the player go; its record writes are refused by
     * their own versions.
     */
    takeOver(playerId: string, fromZone: string, toZone: string, kind?: string): Promise<PlayerLease> {
        return this.write_(playerId, (current) => {
            if (current && current.zoneId !== fromZone && current.zoneId !== toZone && current.until > this.now_()) {
                throw new LeaseHeld(playerId, current.zoneId, current.until);
            }
            return { zoneId: toZone, kind };
        });
    }

    /**
     * Give the player to `toZone`, from `fromZone` which must hold them now. The
     * destination finds the lease already its own when the player arrives. With
     * `arrivalMs` the handed-over lease lasts only that long, until the
     * destination renews it on arrival: should the player never get there (the
     * destination died), they are free again after `arrivalMs`, not `ttlMs`.
     */
    handOff(playerId: string, fromZone: string, toZone: string, arrivalMs?: number, kind?: string): Promise<PlayerLease> {
        return this.write_(playerId, (current) => {
            if (!current || current.zoneId !== fromZone || current.until <= this.now_()) {
                throw new LeaseHeld(playerId, current?.zoneId ?? '', current?.until ?? 0);
            }
            return { zoneId: toZone, kind, arriving: true, from: fromZone };
        }, arrivalMs);
    }

    /**
     * Let the player go, if this zone still holds them. The lease is kept,
     * expired, as where they were last. Returns whether this zone held them.
     */
    async release(playerId: string, zoneId: string): Promise<boolean> {
        const key = this.prefix_ + playerId;
        for (let attempt = 0; attempt < 5; attempt++) {
            const doc = await this.store_.get<PlayerLease>(key);
            if (!doc || doc.value.zoneId !== zoneId || doc.value.until === 0) return false;
            try {
                await this.store_.put<PlayerLease>(key, { ...doc.value, until: 0 }, { expectVersion: doc.version });
                return true;
            } catch (err) {
                if (!(err instanceof PersistConflict)) throw err;
            }
        }
        return false;
    }

    /** Read, decide, write with the version read; retried when someone wrote in between. */
    private async write_(
        playerId: string,
        decide: (current: PlayerLease | null) => { zoneId: string; kind?: string; arriving?: boolean; from?: string },
        ttlMs = this.ttlMs_,
    ): Promise<PlayerLease> {
        const key = this.prefix_ + playerId;
        for (let attempt = 0; attempt < 5; attempt++) {
            const doc = await this.store_.get<PlayerLease>(key);
            const next = decide(doc?.value ?? null);
            const lease: PlayerLease = { playerId, zoneId: next.zoneId, until: this.now_() + ttlMs };
            const kind = next.kind ?? (doc?.value.zoneId === next.zoneId ? doc.value.kind : undefined);
            if (kind !== undefined) lease.kind = kind;
            if (next.arriving) { lease.arriving = true; if (next.from !== undefined) lease.from = next.from; }
            try {
                await this.store_.put(key, lease, { expectVersion: doc?.version ?? 0 });
                return lease;
            } catch (err) {
                if (!(err instanceof PersistConflict)) throw err;
            }
        }
        throw new Error(`[zones] the lease of "${playerId}" kept changing under every write`);
    }
}
