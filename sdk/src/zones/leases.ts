// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    leases.ts
 * @brief   Which zone a player is in, as one fact every zone agrees on. A zone
 *          holds a player's lease while the player is there, renews it while
 *          they stay, and gives it up — or hands it to another zone — when
 *          they leave. Everything is a versioned write, so two zones racing for
 *          one player cannot both win, and a lease nobody renews runs out: a
 *          zone that crashes frees its players after `ttlMs`.
 *
 *          Clocks matter here: expiry compares a holder's write time against
 *          the reader's clock, so zones that share leases need clocks within a
 *          small fraction of `ttlMs` of each other (NTP does this).
 */
import { PersistConflict, type PersistStore } from '../persist/store';

export interface PlayerLease {
    playerId: string;
    zoneId: string;
    /** Epoch ms after which the lease is free if not renewed. */
    until: number;
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
        const doc = await this.store_.get<PlayerLease>(this.prefix_ + playerId);
        if (!doc || doc.value.until <= this.now_()) return null;
        return doc.value;
    }

    /**
     * Take (or keep) the player for `zoneId`. Succeeds when the lease is free,
     * expired, or already this zone's; throws {@link LeaseHeld} when another
     * zone holds a live one.
     */
    acquire(playerId: string, zoneId: string): Promise<PlayerLease> {
        return this.write_(playerId, (current) => {
            if (current && current.zoneId !== zoneId && current.until > this.now_()) {
                throw new LeaseHeld(playerId, current.zoneId, current.until);
            }
            return zoneId;
        });
    }

    /** Extend a lease this zone holds. Throws {@link LeaseHeld} if it was lost to another zone. */
    renew(playerId: string, zoneId: string): Promise<PlayerLease> {
        return this.acquire(playerId, zoneId);
    }

    /**
     * Give the player to `toZone`, from `fromZone` which must hold them now. The
     * destination finds the lease already its own when the player arrives. With
     * `arrivalMs` the handed-over lease lasts only that long, until the
     * destination renews it on arrival: should the player never get there (the
     * destination died), they are free again after `arrivalMs`, not `ttlMs`.
     */
    handOff(playerId: string, fromZone: string, toZone: string, arrivalMs?: number): Promise<PlayerLease> {
        return this.write_(playerId, (current) => {
            if (!current || current.zoneId !== fromZone || current.until <= this.now_()) {
                throw new LeaseHeld(playerId, current?.zoneId ?? '', current?.until ?? 0);
            }
            return toZone;
        }, arrivalMs);
    }

    /** Let the player go, if this zone still holds them. Returns whether it did. */
    async release(playerId: string, zoneId: string): Promise<boolean> {
        for (let attempt = 0; attempt < 5; attempt++) {
            const doc = await this.store_.get<PlayerLease>(this.prefix_ + playerId);
            if (!doc || doc.value.zoneId !== zoneId) return false;
            try {
                await this.store_.delete(this.prefix_ + playerId, { expectVersion: doc.version });
                return true;
            } catch (err) {
                if (!(err instanceof PersistConflict)) throw err;
            }
        }
        return false;
    }

    /** Read, decide, write with the version read; retried when someone wrote in between. */
    private async write_(playerId: string, decide: (current: PlayerLease | null) => string, ttlMs = this.ttlMs_): Promise<PlayerLease> {
        const key = this.prefix_ + playerId;
        for (let attempt = 0; attempt < 5; attempt++) {
            const doc = await this.store_.get<PlayerLease>(key);
            const zoneId = decide(doc?.value ?? null);
            const lease: PlayerLease = { playerId, zoneId, until: this.now_() + ttlMs };
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
