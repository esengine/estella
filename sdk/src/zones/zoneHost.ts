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
import type { ZoneBus } from './bus';

/** What one zone tells another over the bus. */
type ZoneEnvelope =
    | { k: 'player'; playerId: string; type: string; data?: unknown; hops: number }
    | { k: 'kick'; playerId: string; message?: string; hops: number };

/** What every zone hears on the shared topic. */
interface ZoneBroadcast {
    from: string;
    type: string;
    data?: unknown;
}

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
     * Messages between zones: what is sent to a player in another zone, a kick
     * there, and what every zone hears. Without it a zone reaches only its own
     * players. A `MemoryBus` for zones in one process, a `RemoteBus` to a
     * `BusHub` across processes.
     */
    bus?: ZoneBus;
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
    /**
     * Why the player is being placed: a `login` here, or a `drain` — this zone
     * is shutting down and must send everyone it holds somewhere else (a route
     * that returns here or null for a drain leaves the player to be kicked at
     * the deadline).
     */
    reason: 'login' | 'drain';
    /** The default answer, for a route that only overrides some cases. */
    defaultRoute(): Promise<ZoneRouteResult>;
}

export interface ZoneDrainOptions {
    /** Players not moved by now are kicked (their records are written). Default 30 s. */
    deadlineMs?: number;
    /** Transfers under way at once. Default 16. */
    concurrency?: number;
    /** What a kicked player's client is told. Default "server shutting down". */
    message?: string;
}

export interface ZoneDrainReport {
    /** Players sent to another zone. */
    moved: number;
    /** Players with nowhere to go, or whose transfer kept failing, kicked at the deadline. */
    kicked: number;
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
    /** Up, and taking players: heartbeating within `freshMs` and not draining. */
    const open = async (id: string): Promise<boolean> => {
        const z = await directory.get(id, freshMs);
        return z !== null && !z.draining;
    };
    const homeElsewhere = async (): Promise<ZoneRouteResult> =>
        home !== undefined && home !== here && await open(home) ? home : null;
    if (ctx.reason === 'drain') {
        // Somewhere else of the same kind, else home.
        if (last?.kind !== undefined) {
            const line = await directory.pick(last.kind, freshMs);
            if (line && line.id !== here) return line.id;
        }
        return homeElsewhere();
    }
    if (!last) return homeElsewhere();
    if (last.zoneId === here) return null;
    if (await open(last.zoneId)) return last.zoneId;
    if (last.kind !== undefined) {
        const line = await directory.pick(last.kind, freshMs);
        if (line) return line.id === here ? null : line.id;
    }
    return homeElsewhere();
}

/** How long a message waits for a player on their way to this zone, and how many wait. */
const HOLD_FOR_ARRIVAL_MS = 3000;
const HOLD_FOR_ARRIVAL_MAX = 32;

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
    private draining_ = false;
    private readonly playerHandlers_ = new Map<string, Set<(playerId: string, connectionId: number, data: unknown) => void>>();
    private readonly zoneHandlers_ = new Map<string, Set<(data: unknown, fromZone: string) => void>>();
    private offBus_: (() => void)[] = [];
    /**
     * Messages for players on their way here (their lease is this zone's, they
     * are not connected yet): held a moment and given to them when they are.
     */
    private readonly held4Arrival_ = new Map<string, { until: number; messages: { type: string; data: unknown }[] }>();
    /** Messages for players being transferred out: sent after them once the transfer is done, or given here if it fails. */
    private readonly held4Leaving_ = new Map<string, { type: string; data: unknown }[]>();

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

    /** Be listed, and hear the bus. Call once the server accepts connections. */
    async start(): Promise<void> {
        const bus = this.options_.bus;
        if (bus && this.offBus_.length === 0) {
            this.offBus_.push(bus.subscribe(`zone:${this.zoneId}`, (m) => this.fromBus_(m as ZoneEnvelope)));
            this.offBus_.push(bus.subscribe('zones', (m) => this.fromZones_(m as ZoneBroadcast)));
        }
        await this.announce_();
    }

    /**
     * Send a game message to a player wherever they are: here, it goes to their
     * client (`ReplicationClient.onMessage`) unless `onPlayerMessage` handles it;
     * in another zone, over the bus to that zone, which does the same. A player
     * who moved on while it travelled is followed one zone further. Resolves
     * whether the player was online anywhere; delivery is at most once.
     */
    async sendToPlayer(playerId: string, type: string, data?: unknown): Promise<boolean> {
        if (this.deliver_(playerId, type, data)) return true;
        if (this.holdForLeaving_(playerId, type, data)) return true;
        const lease = await this.leases.get(playerId);
        if (!lease || lease.zoneId === this.zoneId || !this.options_.bus) return false;
        this.options_.bus.publish(`zone:${lease.zoneId}`, { k: 'player', playerId, type, data, hops: 0 } satisfies ZoneEnvelope);
        return true;
    }

    /** Kick a player wherever they are. Resolves whether they were online anywhere. */
    async kickPlayer(playerId: string, message?: string): Promise<boolean> {
        if (this.kickHere_(playerId, message)) return true;
        const lease = await this.leases.get(playerId);
        if (!lease || lease.zoneId === this.zoneId || !this.options_.bus) return false;
        this.options_.bus.publish(`zone:${lease.zoneId}`, { k: 'kick', playerId, message, hops: 0 } satisfies ZoneEnvelope);
        return true;
    }

    /** Tell every zone (this one too): an announcement, an event starting. */
    broadcastZones(type: string, data?: unknown): void {
        const msg: ZoneBroadcast = data === undefined ? { from: this.zoneId, type } : { from: this.zoneId, type, data };
        if (this.options_.bus) this.options_.bus.publish('zones', msg);
        else this.fromZones_(msg);
    }

    /** Hear what any zone broadcasts. Returns an unsubscribe. */
    onZoneMessage(type: string, handler: (data: unknown, fromZone: string) => void): () => void {
        let set = this.zoneHandlers_.get(type);
        if (!set) { set = new Set(); this.zoneHandlers_.set(type, set); }
        set.add(handler);
        return () => { set!.delete(handler); };
    }

    /**
     * Handle messages sent to players here (`sendToPlayer`, from this zone or
     * another) instead of passing them to the client: to filter, store or
     * translate them. Returns an unsubscribe.
     */
    onPlayerMessage(type: string, handler: (playerId: string, connectionId: number, data: unknown) => void): () => void {
        let set = this.playerHandlers_.get(type);
        if (!set) { set = new Set(); this.playerHandlers_.set(type, set); }
        set.add(handler);
        return () => { set!.delete(handler); };
    }

    /** A message for a player, if they are connected here. */
    private deliver_(playerId: string, type: string, data: unknown): boolean {
        const server = this.server_;
        if (!server || this.leaving_.has(playerId)) return false;
        const id = server.connectionIdOf(playerId);
        if (id === undefined || !server.clientIds.includes(id)) return false;
        const handlers = this.playerHandlers_.get(type);
        if (handlers && handlers.size > 0) {
            for (const h of [...handlers]) {
                try { h(playerId, id, data); } catch { /* one handler does not stop the rest */ }
            }
            return true;
        }
        return server.message(id, type, data);
    }

    private kickHere_(playerId: string, message?: string): boolean {
        const server = this.server_;
        if (!server) return false;
        const id = server.connectionIdOf(playerId);
        if (id === undefined) return false;
        return server.kick(id, message);
    }

    private fromBus_(m: ZoneEnvelope): void {
        if (!m || typeof m.playerId !== 'string') return;
        const done = m.k === 'player'
            ? this.deliver_(m.playerId, m.type, m.data) || this.holdForLeaving_(m.playerId, m.type, m.data)
            : this.kickHere_(m.playerId, m.message);
        if (done || !this.options_.bus) return;
        void this.leases.get(m.playerId).then((lease) => {
            if (!lease) return;
            if (lease.zoneId === this.zoneId) {
                // On their way here: hold it until they are connected.
                if (m.k === 'player' && !this.deliver_(m.playerId, m.type, m.data)) this.holdForArrival_(m.playerId, m.type, m.data);
                return;
            }
            // Moved on while the message travelled: follow them once.
            if (m.hops < 1) this.options_.bus!.publish(`zone:${lease.zoneId}`, { ...m, hops: m.hops + 1 });
        }).catch(() => undefined);
    }

    /** A player being transferred out: keep the message to send after them. */
    private holdForLeaving_(playerId: string, type: string, data: unknown): boolean {
        if (!this.leaving_.has(playerId)) return false;
        let held = this.held4Leaving_.get(playerId);
        if (!held) { held = []; this.held4Leaving_.set(playerId, held); }
        if (held.length < HOLD_FOR_ARRIVAL_MAX) held.push({ type, data });
        return true;
    }

    private holdForArrival_(playerId: string, type: string, data: unknown): void {
        let held = this.held4Arrival_.get(playerId);
        if (!held) { held = { until: 0, messages: [] }; this.held4Arrival_.set(playerId, held); }
        held.until = this.now_() + HOLD_FOR_ARRIVAL_MS;
        if (held.messages.length < HOLD_FOR_ARRIVAL_MAX) held.messages.push({ type, data });
    }

    /** Give held messages to players who have arrived; drop those for players who never did. */
    private releaseHeld_(): void {
        if (this.held4Arrival_.size === 0) return;
        const now = this.now_();
        for (const [pid, held] of [...this.held4Arrival_]) {
            const server = this.server_;
            const id = server?.connectionIdOf(pid);
            if (server && id !== undefined && server.clientIds.includes(id)) {
                this.held4Arrival_.delete(pid);
                for (const msg of held.messages) this.deliver_(pid, msg.type, msg.data);
            } else if (held.until <= now) {
                this.held4Arrival_.delete(pid);
            }
        }
    }

    private fromZones_(m: ZoneBroadcast): void {
        if (!m || typeof m.type !== 'string') return;
        const handlers = this.zoneHandlers_.get(m.type);
        if (!handlers) return;
        for (const h of [...handlers]) {
            try { h(m.data, m.from); } catch { /* one handler does not stop the rest */ }
        }
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
        let target = await this.route_(playerId, last, 'login');
        // Shutting down: nobody new stays. Where a login would land here, it is
        // placed as the drain places those already here.
        if (this.draining_ && (!target || target.zone === here)) {
            target = await this.route_(playerId, last ?? { playerId, zoneId: here, kind, until: 0 }, 'drain');
        }
        if (target && target.zone !== here) {
            const dest = await this.directory.get(target.zone, fresh);
            // A destination that is not up (or is shutting down too) keeps them here
            // rather than turning them away — unless here is shutting down.
            if (dest && !dest.draining) {
                await this.leases.handOff(playerId, here, target.zone, this.options_.arrivalLeaseMs ?? 3000, dest.kind);
                const ticket = await this.tickets.issue({ playerId, toZone: target.zone, fromZone: here, arrival: target.arrival });
                throw new ReplicationRedirect(dest.address, ticket);
            }
        }
        if (this.draining_) {
            await this.leases.release(playerId, here).catch(() => false);
            throw retryLater('this zone is shutting down; try again shortly');
        }
        this.held_.add(playerId);
        return { playerId };
    };

    /** Ask the route where a player goes, as a zone and arrival, or null for here. */
    private async route_(playerId: string, last: PlayerLease | null, reason: 'login' | 'drain'): Promise<{ zone: string; arrival?: unknown } | null> {
        const ctx: ZoneRouteContext = {
            playerId, last, here: this.zoneId, home: this.options_.home, directory: this.directory,
            freshMs: this.heartbeatMs_ * 3, reason,
            defaultRoute: () => defaultZoneRoute(ctx),
        };
        const routed = await (this.options_.route ?? defaultZoneRoute)(ctx);
        return routed === null ? null : typeof routed === 'string' ? { zone: routed } : routed;
    }

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
        this.releaseHeld_();
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
        if (dest.draining) throw new Error(`[zones] zone "${toZone}" is shutting down`);
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
            // What arrived for them on the way out goes after them; the
            // destination holds it until they are connected there.
            const held = this.held4Leaving_.get(pid);
            this.held4Leaving_.delete(pid);
            if (held && this.options_.bus) {
                for (const msg of held) this.options_.bus.publish(`zone:${toZone}`, { k: 'player', playerId: pid, type: msg.type, data: msg.data, hops: 1 } satisfies ZoneEnvelope);
            }
        } finally {
            this.leaving_.delete(pid);
            // Still here (the transfer failed): give them what was held.
            const held = this.held4Leaving_.get(pid);
            this.held4Leaving_.delete(pid);
            for (const msg of held ?? []) this.deliver_(pid, msg.type, msg.data);
        }
    }

    /** Whether `drain` has begun. */
    get draining(): boolean {
        return this.draining_;
    }

    /**
     * Shut this zone down without dropping anyone: for a rolling update, or to
     * take a line away. The zone is marked draining at once — no route, `pick`
     * or transfer sends anyone here, and a login here is sent on — and every
     * player it holds is transferred where the route says (`reason: 'drain'`;
     * by default another live zone of this kind, else `home`), a few at a time.
     * Players nothing can be found for, or whose transfer keeps failing, are
     * kicked at `deadlineMs`. Then `stop()`: records written, leases freed, the
     * zone off the directory. Keep calling `tick()` until it resolves.
     */
    async drain(options: ZoneDrainOptions = {}): Promise<ZoneDrainReport> {
        const server = this.requireServer_();
        const deadline = this.now_() + (options.deadlineMs ?? 30_000);
        const concurrency = Math.max(1, options.concurrency ?? 16);
        this.draining_ = true;
        await this.announce_().catch((err) => this.options_.onError?.(err, 'heartbeat'));
        let moved = 0;
        const trying = new Set<string>();
        while (this.now_() < deadline) {
            const waiting: { pid: string; id: number }[] = [];
            for (const id of server.clientIds) {
                const pid = server.playerIdOf(id);
                if (pid !== undefined && !this.leaving_.has(pid) && !trying.has(pid)) waiting.push({ pid, id });
            }
            // Players away in their reconnect grace cannot be moved: stop() writes
            // them down, and their client finds a zone through its entry.
            if (waiting.length === 0 && trying.size === 0 && this.leaving_.size === 0) break;
            for (const { pid, id } of waiting.slice(0, Math.max(0, concurrency - trying.size))) {
                trying.add(pid);
                void (async () => {
                    const target = await this.route_(pid, await this.leases.last(pid), 'drain');
                    if (!target || target.zone === this.zoneId) return;
                    await this.transfer(id, target.zone, target.arrival as A | undefined);
                    moved++;
                })().catch(() => undefined).finally(() => {
                    // A player not moved is tried again after a moment, until the deadline.
                    setTimeout(() => trying.delete(pid), 250);
                });
            }
            await new Promise((r) => setTimeout(r, 50));
        }
        let kicked = 0;
        for (const id of server.presentIds) {
            if (server.kick(id, options.message ?? 'server shutting down')) kicked++;
        }
        await this.stop();
        return { moved, kicked };
    }

    /** For shutdown: records written, leases freed, and the zone taken off the directory. */
    async stop(): Promise<void> {
        for (const off of this.offBus_) off();
        this.offBus_ = [];
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
            ...(this.draining_ ? { draining: true } : {}),
        });
    }

    private requireServer_(): ReplicationServer {
        if (!this.server_) throw new Error('[zones] attach(server) before using the zone');
        return this.server_;
    }
}
