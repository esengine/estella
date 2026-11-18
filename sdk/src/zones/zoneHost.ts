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
import { ReplicationRedirect, type ReplicationServer, type ReplicationHelloInfo, type ReplicationPlayer } from '../net/replication/server';
import type { PersistStore } from '../persist/store';
import type { PlayerPersistence } from '../persist/players';
import { ZoneDirectory } from './directory';
import { LeaseHeld, PlayerLeases, type PlayerLease } from './leases';
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
    /** Where a player goes when nothing else says: a new player, or one whose zone and its kind are all gone. */
    home?: string;
    /**
     * Where a player who logs in here belongs. Called for every login that is
     * not a transfer, with where they were last; return a zone id (or `{ zone,
     * arrival }`) to send them there, or null to keep them here. Default
     * {@link defaultZoneRoute}: back to their last zone if it is up, else the
     * emptiest zone of its kind, else `home`, else here. Override it for what
     * only the game knows — a dungeon instance that is gone, a party to keep
     * together — and call `ctx.defaultRoute()` for the rest.
     */
    route?: ZoneRoute;
}

/** What a route is asked with. */
export interface ZoneRouteContext {
    playerId: string;
    /** Where the player was last (the zone, its kind, and whether that lease is still live); null for a new player. */
    last: PlayerLease | null;
    /** The zone answering this login. */
    here: string;
    home: string | undefined;
    directory: ZoneDirectory;
    /** How recently a zone must have heartbeat to count as up. */
    freshMs: number;
    /** The default answer, for a route that only overrides some cases. */
    defaultRoute(): Promise<ZoneRouteResult>;
}

/** A zone id, a zone id with what the arrival there needs, or null for "stay here". */
export type ZoneRouteResult = string | { zone: string; arrival?: unknown } | null;
export type ZoneRoute = (ctx: ZoneRouteContext) => ZoneRouteResult | Promise<ZoneRouteResult>;

/**
 * The route most games want: back where they were if that zone is up; if it is
 * gone, the zone of the same kind with the most room; failing that `home`;
 * failing that, here.
 */
export async function defaultZoneRoute(ctx: ZoneRouteContext): Promise<ZoneRouteResult> {
    const { last, here, home, directory, freshMs } = ctx;
    if (!last) return home !== undefined && home !== here && await directory.get(home, freshMs) ? home : null;
    if (last.zoneId === here) return null;
    if (await directory.get(last.zoneId, freshMs)) return last.zoneId;
    if (last.kind !== undefined) {
        const line = await directory.pick(last.kind, freshMs);
        if (line) return line.id === here ? null : line.id;
    }
    if (home !== undefined && home !== here && await directory.get(home, freshMs)) return home;
    return null;
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
     * player the ticket names. Any other is a login, and any zone takes one:
     * the game's `authenticate` says who it is, and then
     *
     * - a player online in another zone that is up is sent there, which takes
     *   them over from their older connection;
     * - a player held by a zone that has stopped heartbeating is taken from it;
     * - the route says where they belong, and they are sent there with a
     *   ticket, or kept here.
     */
    readonly authenticate = async (credentials: unknown, hello: ReplicationHelloInfo): Promise<ReplicationPlayer> => {
        const here = this.zoneId;
        const kind = this.options_.zone.kind;
        if (hello.transfer !== undefined) {
            const ticket = await this.tickets.redeem<A>(hello.transfer, here);
            this.arrivals_.set(ticket.playerId, ticket.arrival);
            await this.claim_(() => this.leases.acquire(ticket.playerId, here, kind));
            this.held_.add(ticket.playerId);
            return { playerId: ticket.playerId };
        }

        const playerId = (await this.options_.authenticate(credentials, hello)).playerId;
        const fresh = this.heartbeatMs_ * 3;
        const last = await this.leases.last(playerId);
        // Sent from here and back again without arriving: theirs to take back now,
        // and not to be routed straight back to where they could not get to.
        const bounced = last !== null && last.arriving === true && last.from === here && last.until > this.now_();
        if (last && last.zoneId !== here && last.until > this.now_()) {
            const holder = bounced ? null : await this.directory.get(last.zoneId, fresh);
            // Online there: that zone replaces their older connection with this one.
            if (holder) throw new ReplicationRedirect(holder.address);
            // Held by a zone that is gone, or bounced: take them.
            await this.claim_(() => this.leases.takeOver(playerId, last.zoneId, here, kind));
        } else {
            await this.claim_(() => this.leases.acquire(playerId, here, kind));
        }

        if (bounced) {
            this.held_.add(playerId);
            return { playerId };
        }
        const ctx: ZoneRouteContext = {
            playerId, last, here, home: this.options_.home, directory: this.directory, freshMs: fresh,
            defaultRoute: () => defaultZoneRoute(ctx),
        };
        const routed = await (this.options_.route ?? defaultZoneRoute)(ctx);
        const target = routed === null ? null : typeof routed === 'string' ? { zone: routed } : routed;
        if (target && target.zone !== here) {
            const dest = await this.directory.get(target.zone, fresh);
            // A destination that is not up keeps them here rather than turning them away.
            if (dest) {
                await this.leases.handOff(playerId, here, target.zone, this.options_.arrivalLeaseMs ?? 3000, dest.kind);
                const ticket = await this.tickets.issue({ playerId, toZone: target.zone, fromZone: here, arrival: target.arrival });
                throw new ReplicationRedirect(dest.address, ticket);
            }
        }
        this.held_.add(playerId);
        return { playerId };
    };

    /** A lease write that lost a race is a login to retry, not a failure. */
    private async claim_(write: () => Promise<PlayerLease>): Promise<void> {
        try {
            await write();
        } catch (err) {
            if (err instanceof LeaseHeld) throw retryLater(`already in zone "${err.heldBy}"; try again shortly`);
            throw err;
        }
    }

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
                void this.leases.renew(pid, this.zoneId, this.options_.zone.kind).catch((err) => {
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
            await this.leases.handOff(pid, this.zoneId, toZone, this.options_.arrivalLeaseMs ?? 3000, dest.kind);
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
