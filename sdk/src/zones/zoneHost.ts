// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    zoneHost.ts
 * @brief   One zone server's side of a world split over processes: it is
 *          listed in the directory, holds the leases of the players it has,
 *          loads and saves their records, and sends them to other zones.
 *
 *          A transfer is an order of steps, and the order is the guarantee:
 *          the record is written, then the lease is handed to the destination,
 *          then a ticket is issued, and only then is the client told where to
 *          go. The destination redeems the ticket, so it can only be reached
 *          after the record it will load is the one just written, and the
 *          lease means no zone but the destination writes that record again.
 */
import type { ReplicationServer, ReplicationHelloInfo, ReplicationPlayer } from '../net/replication/server';
import type { PersistStore } from '../persist/store';
import type { PlayerPersistence } from '../persist/players';
import { ZoneDirectory } from './directory';
import { LeaseHeld, PlayerLeases } from './leases';
import { TransferTickets } from './tickets';

export interface ZoneHostOptions {
    /** This zone: its id, the address clients dial, and how it is grouped and sized. */
    zone: { id: string; address: string; kind?: string; capacity?: number };
    /** The store every zone shares: directory, leases and tickets live in it. */
    store: PersistStore;
    /** The game's login, for a hello without a transfer ticket. */
    authenticate(credentials: unknown, hello: ReplicationHelloInfo): ReplicationPlayer | Promise<ReplicationPlayer>;
    /** Player records to load on arrival and write on departure; the game's shape. */
    players?: PlayerPersistence<unknown>;
    /** Directory time to live. Default 15 s. */
    directoryTtlMs?: number;
    /**
     * How often this zone tells the directory it is up. Default 1 s. A transfer
     * goes only to a zone heard from within three of these, so this is what
     * bounds how long players keep being sent to a zone that has died.
     */
    heartbeatMs?: number;
    /** Lease time to live. Default 30 s; renewed every third of it. */
    leaseTtlMs?: number;
    /**
     * How long a transferred player's lease lasts before the destination takes
     * it up. Default 3 s. If the destination died, the player is free to log in
     * elsewhere after this, not after a whole lease.
     */
    arrivalLeaseMs?: number;
    /** How long a transfer ticket is good for. Default 30 s. */
    ticketTtlMs?: number;
    /** A background step that failed (heartbeat, lease renewal, a departure's save). */
    onError?(error: unknown, during: 'heartbeat' | 'renew' | 'release'): void;
    now?: () => number;
}

/** A refusal the client should retry, named the way the replication server recognizes. */
function retryLater(message: string): Error {
    const err = new Error(message) as Error & { fatal: boolean };
    err.name = 'SessionRejected';
    err.fatal = false;
    return err;
}

export class ZoneHost<A = unknown> {
    readonly directory: ZoneDirectory;
    readonly leases: PlayerLeases;
    readonly tickets: TransferTickets;
    private readonly options_: ZoneHostOptions;
    private readonly now_: () => number;
    private server_: ReplicationServer | null = null;
    /** Players whose lease this zone holds. */
    private readonly held_ = new Set<string>();
    /** Players being transferred out: no renewal, no release, no reload. */
    private readonly leaving_ = new Set<string>();
    private readonly arrivals_ = new Map<string, A>();
    private nextHeartbeat_ = 0;
    private nextRenew_ = 0;

    constructor(options: ZoneHostOptions) {
        this.options_ = options;
        this.now_ = options.now ?? Date.now;
        this.directory = new ZoneDirectory({ store: options.store, ttlMs: options.directoryTtlMs, now: options.now });
        this.leases = new PlayerLeases({ store: options.store, ttlMs: options.leaseTtlMs, now: options.now });
        this.tickets = new TransferTickets({ store: options.store, ttlMs: options.ticketTtlMs, now: options.now });
    }

    get zoneId(): string {
        return this.options_.zone.id;
    }

    private get heartbeatMs_(): number {
        return this.options_.heartbeatMs ?? Math.min(1000, this.directory.ttlMs / 3);
    }

    /** The server this zone runs. `startServer({ authenticate: zone.authenticate })`, then this. */
    attach(server: ReplicationServer): void {
        this.server_ = server;
    }

    /** Be listed. Call once the server accepts connections. */
    async start(): Promise<void> {
        await this.announce_();
    }

    /**
     * Hand to `startServer`. A hello with a transfer ticket is admitted as the
     * player the ticket names (no other login); any other goes through the
     * game's `authenticate`, and is turned away for now while another zone
     * holds the player.
     */
    readonly authenticate = async (credentials: unknown, hello: ReplicationHelloInfo): Promise<ReplicationPlayer> => {
        let playerId: string;
        if (hello.transfer !== undefined) {
            const ticket = await this.tickets.redeem<A>(hello.transfer, this.zoneId);
            playerId = ticket.playerId;
            this.arrivals_.set(playerId, ticket.arrival);
        } else {
            playerId = (await this.options_.authenticate(credentials, hello)).playerId;
        }
        try {
            await this.leases.acquire(playerId, this.zoneId);
        } catch (err) {
            if (err instanceof LeaseHeld) throw retryLater(`already in zone "${err.heldBy}"; try again shortly`);
            throw err;
        }
        this.held_.add(playerId);
        return { playerId };
    };

    /**
     * What the ticket that brought this player here said about their arrival,
     * taken once: the game reads it when it places them. Undefined for a player
     * who logged in rather than arrived.
     */
    takeArrival(playerId: string): A | undefined {
        const a = this.arrivals_.get(playerId);
        this.arrivals_.delete(playerId);
        return a;
    }

    /** Every tick: records follow the players present, leases are renewed, and the directory hears from us. */
    tick(): void {
        const server = this.requireServer_();
        const present = new Set<string>();
        for (const id of server.presentIds) {
            const pid = server.playerIdOf(id);
            if (pid !== undefined && !this.leaving_.has(pid)) present.add(pid);
        }
        this.options_.players?.track(present);

        // A player gone from here: their record is written, then the lease freed.
        for (const pid of [...this.held_]) {
            if (present.has(pid) || this.leaving_.has(pid)) continue;
            this.held_.delete(pid);
            this.arrivals_.delete(pid);
            const saved = this.options_.players?.release(pid) ?? Promise.resolve();
            void saved
                .then(() => (this.held_.has(pid) ? false : this.leases.release(pid, this.zoneId)))
                .catch((err) => this.options_.onError?.(err, 'release'));
        }

        const now = this.now_();
        if (now >= this.nextRenew_) {
            this.nextRenew_ = now + this.leases.ttlMs / 3;
            for (const pid of present) {
                if (!this.held_.has(pid)) continue;
                void this.leases.renew(pid, this.zoneId).catch((err) => {
                    // Lost to another zone: this one must stop acting for the player.
                    if (err instanceof LeaseHeld) {
                        const id = server.connectionIdOf(pid);
                        this.held_.delete(pid);
                        if (id !== undefined) server.kick(id, 'signed in elsewhere');
                    }
                    this.options_.onError?.(err, 'renew');
                });
            }
        }
        if (now >= this.nextHeartbeat_) {
            this.nextHeartbeat_ = now + this.heartbeatMs_;
            void this.announce_().catch((err) => this.options_.onError?.(err, 'heartbeat'));
        }
    }

    /**
     * Send a connected player to zone `toZone`, to arrive with `arrival`. Write
     * what the player's record should hold first (`players.set`); this saves
     * it, hands the lease over, issues the ticket, and tells the client. Throws,
     * leaving the player here, when the destination is not up or the lease
     * cannot move.
     */
    async transfer(connectionId: number, toZone: string, arrival?: A): Promise<void> {
        const server = this.requireServer_();
        const pid = server.playerIdOf(connectionId);
        if (pid === undefined) throw new Error(`[zones] connection ${connectionId} is not an authenticated player`);
        if (this.leaving_.has(pid)) throw new Error(`[zones] player "${pid}" is already being transferred`);
        // Heard from within three heartbeats: a zone that died is out of the
        // running within seconds, not a whole directory time to live.
        const dest = await this.directory.get(toZone, this.heartbeatMs_ * 3);
        if (!dest) throw new Error(`[zones] zone "${toZone}" is not up`);
        this.leaving_.add(pid);
        try {
            await (this.options_.players?.release(pid) ?? Promise.resolve());
            await this.leases.handOff(pid, this.zoneId, toZone, this.options_.arrivalLeaseMs ?? 3000);
            this.held_.delete(pid);
            const ticket = await this.tickets.issue<A | undefined>({ playerId: pid, toZone, fromZone: this.zoneId, arrival });
            // Back here if the destination cannot be reached: by then the short
            // arrival lease has run out and this zone takes the player again.
            server.transfer(connectionId, { address: dest.address, ticket, fallback: this.options_.zone.address });
            this.arrivals_.delete(pid);
        } finally {
            this.leaving_.delete(pid);
        }
    }

    /** For shutdown: records written, leases freed, and the zone taken off the directory. */
    async stop(): Promise<void> {
        await this.directory.withdraw(this.zoneId).catch(() => undefined);
        await this.options_.players?.flush();
        await Promise.all([...this.held_].map((pid) => this.leases.release(pid, this.zoneId).catch(() => false)));
        this.held_.clear();
    }

    private announce_(): Promise<void> {
        const z = this.options_.zone;
        const players = this.server_ ? this.server_.presentIds.length : 0;
        return this.directory.announce({
            id: z.id, address: z.address, players,
            ...(z.kind !== undefined ? { kind: z.kind } : {}),
            ...(z.capacity !== undefined ? { capacity: z.capacity } : {}),
        });
    }

    private requireServer_(): ReplicationServer {
        if (!this.server_) throw new Error('[zones] attach(server) before using the zone');
        return this.server_;
    }
}
