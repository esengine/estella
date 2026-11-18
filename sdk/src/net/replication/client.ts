// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    client.ts
 * @brief   The replica endpoint. Handshakes schema + ABI, spawns NetGhost
 *          proxies from server spawn batches (via loadComponent, so codecs and
 *          validation are the scene-loading ones), and queues binary delta
 *          frames to apply at the FixedPreUpdate boundary — state lands at a
 *          deterministic point in the frame, not mid-schedule on socket
 *          timing.
 *
 *          With {@link PredictionOptions} enabled, the entities this connection
 *          owns are simulated locally: `sendInput` applies the command to them
 *          immediately (zero perceived latency) and keeps it in a pending
 *          buffer; authoritative state for owned entities lands in a shadow
 *          "authority copy" instead of the live components; each fixed tick the
 *          live state is rebuilt as authority ⊕ replay of the unacknowledged
 *          commands (one server tick each — the server consumes the input
 *          queue at the same cadence, see `tickInputOf`). Mispredictions can
 *          therefore never accumulate: every field snaps back to the last
 *          authoritative value before the replay. Owned entities bypass
 *          snapshot interpolation entirely.
 */
import type { World } from '../../ecs/world';
import { replay, type ReplayReport, type SpeculationScope } from '../../ecs/speculation';
import type { Entity } from '../../types';
import { getComponent } from '../../ecs/component';
import { ABI_LAYOUT_HASH } from '../../ecs/component.generated';
import { loadComponent } from '../../scene/scene';
import { NetChannel, type ReliableOrderedTransport } from '../NetChannel';
import { log } from '../../util/logger';
import {
    REPLICATION_CHANNEL, REPLICATION_PROTOCOL_VERSION, ReplMsg,
    type ReplAckMsg, type ReplDespawnBatch, type ReplHelloRequest, type ReplHelloResponse,
    type ReplInputMsg, type ReplSpawnBatch, type ReplSpawnEntity,
    type ReplComponentRemoveBatch, type ReplClosedMsg, type ReplCloseReason, type ReplGameMsg,
} from './protocol';
import {
    buildReplicationTable, cloneValue, decodeStateFrame, tableSchemas,
    type EntityRefMap, type FieldShape, type ReplicationTable, type ReplicationTableEntry, type StateFrame,
} from './codec';
import { NetGhost, Replicated, type ReplicatedData } from './components';
import { getReplicationArchetype } from './archetype';
import { NetIds } from './NetIds';
import { InterpolationState } from './interpolation';

/**
 * Client-side prediction for owned entities. `apply` is the same input-to-
 * state logic the server's gameplay runs (register one function, use it on
 * both ends — the single source of the movement rules); with it enabled,
 * `sendInput` also applies the command locally and unacknowledged commands
 * replay on top of every authoritative update.
 */
export interface PredictionOptions {
    /** Advance one owned entity by one fixed tick of `actions`. Must depend
     *  only on world state + actions + dt (it re-runs during reconciliation). */
    apply: (world: World, entity: Entity, actions: Record<string, unknown>, dt: number) => void;
    /** Cap on unacknowledged commands kept for replay (default 120). */
    maxPendingInputs?: number;
    /**
     * Ease reconciliation corrections out instead of hard-snapping: the
     * numeric fields of owned entities keep a decaying visual error toward
     * their pre-correction value. Purely presentational — the simulation
     * rebuilds from the authority copy every tick regardless, so the error can
     * never accumulate. Off by default (corrections snap).
     */
    smoothing?: PredictionSmoothing;
}

/**
 * Ask whether an `apply` is what reconciliation needs it to be.
 *
 * The promise above is the one the rebuild rests on, and until now only a
 * desync could report it broken. Runs the step twice from the same state and
 * takes both back, so a game can ask in a test without paying for it in play.
 *
 * @experimental
 */
export function predictionReplays(
    scope: SpeculationScope,
    prediction: PredictionOptions,
    entity: Entity,
    actions: Record<string, unknown>,
    dt: number,
): ReplayReport {
    return replay(scope, () => {
        prediction.apply(scope.world, entity, actions, dt);
        return 'commit';
    });
}

export interface PredictionSmoothing {
    /** Seconds for the visual error to halve (typical: 0.05–0.15). */
    halfLife: number;
    /**
     * Corrections larger than this (per numeric component) snap immediately —
     * a teleport must look like a teleport. Default: no limit.
     */
    maxError?: number;
}

/** next + decayed (prev − next) over the numeric parts of a replicated field —
 *  shape-driven (the codec's FieldShape is the single source of what's numeric). */
function smoothValue(shape: FieldShape, prev: unknown, next: unknown, keep: number, maxError: number): unknown {
    if (shape.kind === 'f32') {
        if (typeof prev !== 'number' || typeof next !== 'number') return next;
        const err = prev - next;
        if (Math.abs(err) > maxError) return next;
        return next + err * keep;
    }
    if (shape.kind === 'object') {
        if (prev === null || next === null || typeof prev !== 'object' || typeof next !== 'object') return next;
        const out: Record<string, unknown> = { ...(next as Record<string, unknown>) };
        for (let i = 0; i < shape.keys.length; i++) {
            const k = shape.keys[i];
            out[k] = smoothValue(
                shape.shapes[i],
                (prev as Record<string, unknown>)[k],
                (next as Record<string, unknown>)[k],
                keep, maxError,
            );
        }
        return out;
    }
    return next;
}

export interface ReplicationClientOptions {
    /**
     * How many server ticks the presented state trails the newest received
     * data. Two ticks absorbs one lost/late delivery without a visible hitch;
     * 0 disables buffering (state applies the moment it drains).
     */
    interpolationDelayTicks?: number;
    /** Enable client-side prediction for the entities this connection owns. */
    prediction?: PredictionOptions;
    /** Handed to the server's `authenticate` in every hello, the first and each reconnect. */
    credentials?: unknown;
    /**
     * Redial when the link drops. Works over a platform socket (`GameSocket`,
     * `createSocket`), which can be opened again; the client waits, reopens it,
     * says hello with the same credentials and takes up its old connection id
     * when the server still holds the player. Ghosts it already has stay the
     * same entities. Off by default; `true` waits 0.5 s, doubling to 8 s.
     * It stops for good when the server says this player was replaced by
     * another login or kicked, or refuses the hello as final.
     */
    reconnect?: boolean | ReplicationReconnectOptions;
    /**
     * Open a transport to an address a server names when it transfers this
     * client elsewhere (`server.transfer`, `esengine/zones`): typically
     * `(url) => createSocket({ url })`. With it, a transfer drops every ghost
     * from the old server and connects to the new one by itself, showing its
     * ticket. Without it, a transfer ends the client (`closeReason`
     * `'transfer'`, `transferTarget` says where).
     */
    dial?: (address: string) => ReliableOrderedTransport;
    /**
     * Ping the server every `intervalMs`; silent for `timeoutMs` and a link
     * that can be reopened is closed, so `reconnect` redials it — a server
     * that vanished without closing the socket is noticed. Default 5 s / 15 s
     * over a platform socket, off otherwise; `false` turns it off.
     */
    heartbeat?: { intervalMs: number; timeoutMs: number } | false;
    /**
     * Where to log in again when the server this client was on cannot be
     * reached for `entryAfterMs` — typically the address it first connected to,
     * any zone that routes logins (`esengine/zones`). Needs `dial` and
     * `reconnect`. Without it the client redials its own server for good.
     */
    entry?: string | readonly string[];
    /**
     * How long to keep redialing the lost server before going to `entry`, and
     * how long to keep at one entry before trying the next of a list. Default 3 s.
     */
    entryAfterMs?: number;
}

export interface ReplicationReconnectOptions {
    /** First wait after a drop. Default 500 ms. */
    minDelayMs?: number;
    /** Longest wait between attempts. Default 8000 ms. */
    maxDelayMs?: number;
}

/**
 * Where a client's link stands. `reconnecting` is a dropped link being
 * redialed; `closed` is the end — `disconnect()`, a final refusal, or the
 * server letting the player go (`closeReason` says which).
 */
export type ReplicationClientState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'transferring' | 'closed';

/** What a platform socket adds to a transport: it can be reopened, and it says when it closes. */
interface RedialableSocket extends ReliableOrderedTransport {
    readyState: string;
    connect(): void;
    close(code?: number, reason?: string): void;
    on(event: 'message', handler: (data: string | ArrayBuffer) => void): () => void;
    on(event: 'open' | 'close', handler: () => void): () => void;
}

function isRedialable(t: ReliableOrderedTransport): t is RedialableSocket {
    const s = t as Partial<RedialableSocket>;
    return typeof s.connect === 'function' && typeof s.close === 'function' && typeof s.readyState === 'string';
}

/** One received message, tagged so the inbox can stay a single ordered queue. */
type PendingOp = (
    | { kind: 'spawn'; batch: ReplSpawnBatch }
    | { kind: 'despawn'; batch: ReplDespawnBatch }
    | { kind: 'remove'; batch: ReplComponentRemoveBatch }
    | { kind: 'state'; frame: Uint8Array }
    /** Everything held came from a server this client has left: drop it. */
    | { kind: 'reset' }
) & {
    /** The channel it arrived on: where a server change is marked in the inbox. */
    ch?: NetChannel;
};

export class ReplicationClient {
    private readonly world_: World;
    private readonly netIds_ = new NetIds();
    private offDespawn_: (() => void) | null = null;
    private channel_: NetChannel | null = null;
    private table_: ReplicationTable | null = null;
    private connectionId_ = 0;
    private serverTick_ = 0;
    /** Everything received since the last fixed step, in ARRIVAL order — one
     *  queue, not one per kind. Sorting by kind reorders across ticks: a leave
     *  at tick N and a re-enter at N+1 arriving together replay as
     *  re-enter-then-leave, and the entity is gone on the client for good. */
    private readonly inbox_: PendingOp[] = [];
    private readonly interp_: InterpolationState | null;
    private inputSeq_ = 0;
    private prediction_: PredictionOptions | null;
    /** Sent-but-unacknowledged input commands, oldest first (replay order). */
    private readonly pendingInputs_: ReplInputMsg[] = [];
    private ackedSeq_ = 0;
    /** Last authoritative value of every replicated field of every OWNED
     *  entity: netId → componentId → field record. Deltas land here (never in
     *  the live components); reconciliation rebuilds live = this ⊕ replay. */
    private readonly authority_ = new Map<number, Map<number, Record<string, unknown>>>();
    private fixedDelta_ = 1 / 60;
    private readonly credentials_: unknown;
    private readonly reconnect_: Required<ReplicationReconnectOptions> | null;
    private playerId_: string | undefined;
    private state_: ReplicationClientState = 'idle';
    private readonly stateListeners_ = new Set<(state: ReplicationClientState, client: ReplicationClient) => void>();
    private readonly messageHandlers_ = new Map<string, Set<(data: unknown) => void>>();
    private closeReason_: ReplCloseReason | string | undefined;
    /** The next initial batch reconciles against ghosts already held. */
    private resyncing_ = false;
    /** Undoes the redial wiring on the current socket. */
    private offSocket_: (() => void) | null = null;
    private redialTimer_: ReturnType<typeof setTimeout> | null = null;
    private redialDelay_ = 0;
    private readonly dial_: ((address: string) => ReliableOrderedTransport) | null;
    private readonly heartbeat_: { intervalMs: number; timeoutMs: number } | null;
    private readonly entries_: readonly string[];
    /** Which entry the redials under way go to; -1 while redialing the lost server. */
    private entryAt_ = -1;
    /** When the current address started being redialed. */
    private dialingSince_ = 0;
    private readonly entryAfterMs_: number;
    /** When the current run of failed redials began; 0 while connected. */
    private lostSince_ = 0;
    /** The server process the ghosts held came from. */
    private serverId_: string | undefined;
    /** The ticket the next hello shows, while a transfer is under way. */
    private transferTicket_: string | undefined;
    private transferTarget_: { address: string; ticket: string } | undefined;

    constructor(world: World, options: ReplicationClientOptions = {}) {
        this.world_ = world;
        this.credentials_ = options.credentials;
        this.dial_ = options.dial ?? null;
        this.entries_ = options.entry === undefined ? [] : typeof options.entry === 'string' ? [options.entry] : [...options.entry];
        this.entryAfterMs_ = options.entryAfterMs ?? 3000;
        this.heartbeat_ = options.heartbeat === false ? null : (options.heartbeat ?? { intervalMs: 5000, timeoutMs: 15000 });
        const r = options.reconnect;
        this.reconnect_ = r ? {
            minDelayMs: (r === true ? undefined : r.minDelayMs) ?? 500,
            maxDelayMs: (r === true ? undefined : r.maxDelayMs) ?? 8000,
        } : null;
        const delay = options.interpolationDelayTicks ?? 2;
        this.interp_ = delay > 0 ? new InterpolationState(delay) : null;
        this.prediction_ = options.prediction ?? null;
        this.offDespawn_ = world.onDespawn((e) => this.netIds_.unregisterEntity(e));
    }

    get table(): ReplicationTable {
        return (this.table_ ??= buildReplicationTable());
    }

    get netIds(): NetIds {
        return this.netIds_;
    }

    get connected(): boolean {
        return this.channel_ !== null && this.connectionId_ !== 0;
    }

    get connectionId(): number {
        return this.connectionId_;
    }

    /** Who the server says this is, when it authenticates players. */
    get playerId(): string | undefined {
        return this.playerId_;
    }

    get state(): ReplicationClientState {
        return this.state_;
    }

    /**
     * The server process this client is connected to, or was last: a random id
     * per process, so a change says the client is on another server now (a
     * transfer, a reroute, a restart) even where the address is the same.
     */
    get serverId(): string | undefined {
        return this.serverId_;
    }

    /**
     * Hear every change of {@link state}, as it happens — a transfer or a
     * reconnect can pass through several states between two frames, which
     * polling `state` would miss. Read `serverId`, `closeReason` and
     * `connectionId` from the client in the listener. Returns an unsubscribe.
     */
    onStateChange(listener: (state: ReplicationClientState, client: ReplicationClient) => void): () => void {
        this.stateListeners_.add(listener);
        return () => this.stateListeners_.delete(listener);
    }

    private setState_(state: ReplicationClientState): void {
        if (this.state_ === state) return;
        this.state_ = state;
        for (const listener of [...this.stateListeners_]) {
            try { listener(state, this); } catch (err) { log.warn('repl', 'a state listener threw', err); }
        }
    }

    /** Where a transfer told this client to go, when it had no `dial` to go there itself. */
    get transferTarget(): { address: string; ticket: string } | undefined {
        return this.transferTarget_;
    }

    /** Why the link ended for good: the server's `replaced` / `kicked`, or a refusal's message. */
    get closeReason(): ReplCloseReason | string | undefined {
        return this.closeReason_;
    }

    /** The tick stamped on the newest applied state (server time axis). */
    get serverTick(): number {
        return this.serverTick_;
    }

    private get refs_(): EntityRefMap {
        return {
            toWire: (entity) => this.netIds_.netIdOf(entity as Entity) ?? 0,
            fromWire: (netId) => (this.netIds_.entityOf(netId) as number | undefined) ?? 0,
        };
    }

    /** Handshake over the transport; rejects (and detaches) on any mismatch. */
    async connect(transport: ReliableOrderedTransport): Promise<void> {
        if (this.channel_) throw new Error('[repl] client already connected');
        this.setState_('connecting');
        let link = transport;
        let res = await this.handshake_(link);
        // A login routed elsewhere: follow it, a few hops at most.
        for (let hops = 0; !res.ok && res.redirect && hops < 4; hops++) {
            if (!this.dial_) {
                this.disconnect();
                throw new Error(`[repl] redirected to ${res.redirect.address}; connect with a dial to follow it`);
            }
            (this.channel_ as NetChannel | null)?.dispose();
            this.channel_ = null;
            if (isRedialable(link)) link.close(1000, 'redirected');
            link = this.dial_(res.redirect.address);
            if (isRedialable(link) && link.readyState === 'closed') link.connect();
            this.transferTicket_ = res.redirect.ticket;
            res = await this.handshake_(link);
        }
        if (!res.ok) {
            this.disconnect();
            throw new Error(`[repl] server refused connection: ${res.error}`);
        }
        this.watchSocket_(link);
    }

    /**
     * Say hello again over a new link and carry on where the old one left off:
     * the same connection id when the server still holds this player, and the
     * ghosts already held reconciled in place against what the server sends.
     * What `reconnect` does by itself; call it for a transport that cannot be
     * reopened. Rejects when the server refuses.
     */
    async resume(transport: ReliableOrderedTransport): Promise<void> {
        this.cancelRedial_();
        this.offSocket_?.();
        this.offSocket_ = null;
        this.channel_?.dispose();
        this.channel_ = null;
        this.setState_('reconnecting');
        const res = await this.handshake_(transport, true);
        if (!res.ok) {
            (this.channel_ as NetChannel | null)?.dispose();
            this.channel_ = null;
            throw new Error(`[repl] server refused connection: ${res.error}`);
        }
        this.watchSocket_(transport);
    }

    /** One hello over a fresh channel. Leaves the channel installed on success. */
    private async handshake_(transport: ReliableOrderedTransport, resuming = false): Promise<ReplHelloResponse> {
        const beat = this.heartbeat_ && isRedialable(transport) ? this.heartbeat_ : null;
        const channel = new NetChannel(transport, beat ? {
            // Closing the socket is what starts a redial; the channel only notices the silence.
            heartbeat: { ...beat, onDead: () => { if (this.channel_ === channel) (transport as RedialableSocket).close(4001, 'heartbeat timeout'); } },
        } : {});
        this.channel_ = channel;

        // Handlers first: the initial spawn batch may hit the wire before the
        // hello response settles on this side. Batches queue until the fixed
        // step applies them, so ordering stays deterministic either way.
        channel.on<ReplSpawnBatch>(ReplMsg.spawn, (batch) => this.inbox_.push({ kind: 'spawn', batch, ch: channel }));
        channel.on<ReplDespawnBatch>(ReplMsg.despawn, (batch) => this.inbox_.push({ kind: 'despawn', batch, ch: channel }));
        channel.on<ReplComponentRemoveBatch>(ReplMsg.componentRemove, (batch) => this.inbox_.push({ kind: 'remove', batch, ch: channel }));
        channel.on<ReplAckMsg>(ReplMsg.ack, (ack) => {
            if (ack.seq > this.ackedSeq_) this.ackedSeq_ = ack.seq;
        });
        channel.onBinary(REPLICATION_CHANNEL, (payload) => {
            // Copy out: the payload view may alias a transport-owned buffer.
            this.inbox_.push({ kind: 'state', frame: payload.slice(), ch: channel });
        });
        channel.on<ReplClosedMsg>(ReplMsg.closed, (msg) => this.closedByServer_(channel, msg));
        channel.on<ReplGameMsg>(ReplMsg.message, (msg) => {
            if (this.channel_ !== channel || typeof msg?.type !== 'string') return;
            const handlers = this.messageHandlers_.get(msg.type);
            if (!handlers) return;
            for (const h of [...handlers]) {
                try { h(msg.data); } catch (err) { log.warn('repl', `message handler for "${msg.type}" threw`, err); }
            }
        });

        const hello: ReplHelloRequest = {
            protocolVersion: REPLICATION_PROTOCOL_VERSION,
            abiHash: ABI_LAYOUT_HASH,
            components: tableSchemas(this.table),
            ...(this.credentials_ !== undefined ? { credentials: this.credentials_ } : {}),
            ...(this.transferTicket_ !== undefined ? { transfer: this.transferTicket_ } : {}),
        };
        // A socket that closes before the answer (nothing listening there, the
        // server gone mid-hello) fails the hello now, not at the request timeout.
        const offClose = isRedialable(transport) ? transport.on('close', () => channel.dispose('link closed during hello')) : null;
        let res: ReplHelloResponse;
        try {
            res = await channel.request<ReplHelloResponse>(ReplMsg.hello, hello);
        } catch (err) {
            if (!resuming) this.disconnect();
            throw err;
        } finally {
            offClose?.();
        }
        if (this.channel_ !== channel) return { ok: false, error: 'superseded', fatal: false };
        if (!res.ok) {
            if (res.fatal !== false) { this.closeReason_ = res.error; this.setState_('closed'); }
            return res;
        }
        if (resuming) {
            // A new link is a new input stream on the server: what was in flight
            // is gone or already applied, and the next acknowledgement says which.
            this.pendingInputs_.length = 0;
            this.ackedSeq_ = this.inputSeq_;
            this.resyncing_ = true;
        }
        // Another server process: its netIds are not the ones held. Drop the
        // ghosts ahead of the first thing it sent, which may already be queued —
        // and behind everything the old one sent that is still waiting.
        if (res.serverId !== undefined && this.serverId_ !== undefined && res.serverId !== this.serverId_) {
            const first = this.inbox_.findIndex((op) => op.ch === channel);
            this.inbox_.splice(first < 0 ? this.inbox_.length : first, 0, { kind: 'reset' });
        }
        if (res.serverId !== undefined) this.serverId_ = res.serverId;
        this.connectionId_ = res.connectionId;
        this.playerId_ = res.playerId;
        this.serverTick_ = res.tick;
        if (res.fixedDelta > 0) this.fixedDelta_ = res.fixedDelta;
        this.setState_('ready');
        this.closeReason_ = undefined;
        this.redialDelay_ = 0;
        this.lostSince_ = 0;
        this.entryAt_ = -1;
        this.dialingSince_ = 0;
        // A ticket is good once; a later reconnect to this server is an ordinary one.
        this.transferTicket_ = undefined;
        return res;
    }

    /** The server let this link go on purpose: no redial; a transfer goes on elsewhere. */
    private closedByServer_(channel: NetChannel, msg: ReplClosedMsg): void {
        if (this.channel_ !== channel) return;
        this.cancelRedial_();
        this.offSocket_?.();
        this.offSocket_ = null;
        channel.dispose();
        this.channel_ = null;
        if (msg?.reason === 'transfer' && typeof msg.address === 'string' && typeof msg.ticket === 'string') {
            this.beginTransfer_(msg.address, msg.ticket, typeof msg.fallback === 'string' ? msg.fallback : undefined);
            return;
        }
        this.closeReason_ = msg?.reason ?? 'kicked';
        this.setState_('closed');
    }

    /**
     * Leave this server for another. Ghosts from here mean nothing there (netIds
     * are per server), so they go — in order, ahead of anything the new server
     * sends — and the client says hello there with the ticket.
     */
    private beginTransfer_(address: string, ticket: string | undefined, fallback?: string): void {
        if (!this.dial_) {
            this.transferTarget_ = { address, ticket: ticket ?? '' };
            this.closeReason_ = 'transfer';
            this.setState_('closed');
            return;
        }
        this.inbox_.push({ kind: 'reset' });
        this.pendingInputs_.length = 0;
        this.ackedSeq_ = this.inputSeq_;
        this.connectionId_ = 0;
        this.transferTicket_ = ticket;
        this.setState_('transferring');
        const failed = (why: string): void => {
            this.channel_?.dispose();
            this.channel_ = null;
            this.transferTicket_ = undefined;
            if (fallback !== undefined && this.reconnect_) { this.goBack_(fallback); return; }
            this.closeReason_ = `transfer failed: ${why}`;
            this.setState_('closed');
        };
        let transport: ReliableOrderedTransport;
        try {
            transport = this.dial_(address);
        } catch (err) {
            failed(String((err as Error)?.message ?? err));
            return;
        }
        // A platform socket queues the hello until it opens.
        if (isRedialable(transport) && transport.readyState === 'closed') transport.connect();
        void this.handshake_(transport, true).then((res) => {
            if (res.ok) this.watchSocket_(transport);
            else if (res.redirect && this.state_ !== 'closed') this.follow_(transport, res.redirect);
            else if (this.state_ !== 'closed') failed(res.error);
        }, (err) => {
            if (isRedialable(transport)) transport.close(1000, 'transfer failed');
            failed(String((err as Error)?.message ?? err));
        });
    }

    /**
     * The destination of a transfer could not be reached: log in again where
     * the client came from, as an ordinary reconnect that keeps redialing. That
     * server turns it away while the lease is still on its way to the dead
     * zone, and takes it once the short arrival lease has run out.
     */
    private goBack_(address: string): void {
        this.setState_('reconnecting');
        let transport: ReliableOrderedTransport;
        try {
            transport = this.dial_!(address);
        } catch (err) {
            this.closeReason_ = `transfer failed and the way back too: ${(err as Error)?.message ?? err}`;
            this.setState_('closed');
            return;
        }
        if (isRedialable(transport)) {
            // The socket's own open and close drive the hello and the redials.
            this.watchSocket_(transport);
            if (transport.readyState === 'closed') transport.connect();
            return;
        }
        // A transport that cannot be reopened: dial again for each attempt.
        const drop = (): void => { this.channel_?.dispose(); this.channel_ = null; };
        void this.handshake_(transport, true).then((res) => {
            if (res.ok || this.state_ === 'closed') return;
            drop();
            if (res.fatal !== false) { this.closeReason_ = res.error; this.setState_('closed'); return; }
            this.retryBack_(address);
        }, () => { drop(); if (this.state_ !== 'closed') this.retryBack_(address); });
    }

    private retryBack_(address: string): void {
        const r = this.reconnect_!;
        this.redialDelay_ = this.redialDelay_ === 0 ? r.minDelayMs : Math.min(r.maxDelayMs, this.redialDelay_ * 2);
        this.redialTimer_ = setTimeout(() => {
            this.redialTimer_ = null;
            if (this.state_ === 'reconnecting' && !this.channel_) this.goBack_(address);
        }, this.redialDelay_);
    }

    /** Drop every ghost and everything kept about them: they belonged to a server this client left. */
    private resetWorld_(): void {
        const all = this.netIds_.netIdList();
        if (all.length > 0) this.applyDespawnBatch_({ tick: this.serverTick_, netIds: all });
        this.authority_.clear();
        this.serverTick_ = 0;
    }

    /** With `reconnect`, follow the socket so a drop starts a redial. */
    private watchSocket_(transport: ReliableOrderedTransport): void {
        if (!this.reconnect_ || !isRedialable(transport)) return;
        const offClose = transport.on('close', () => this.linkLost_(transport));
        const offOpen = transport.on('open', () => {
            if (this.state_ !== 'reconnecting' || this.channel_) return;
            void this.handshake_(transport, true).then((res) => {
                if (res.ok || this.state_ === 'closed') return;
                // Routed elsewhere (a login at an entry, sent on to its zone).
                if (res.redirect && this.dial_) { this.follow_(transport, res.redirect); return; }
                // A refusal that is not final: drop the link and let the close redial.
                transport.close(1000, 'hello refused');
            }, () => {
                if (this.state_ !== 'closed') transport.close(1000, 'hello failed');
            });
        });
        this.offSocket_ = () => { offClose(); offOpen(); };
    }

    private linkLost_(socket: RedialableSocket): void {
        if (this.state_ === 'closed' || this.state_ === 'idle') return;
        this.channel_?.dispose();
        this.channel_ = null;
        this.setState_('reconnecting');
        this.lostSince_ ||= Date.now();
        this.dialingSince_ ||= this.lostSince_;
        if (this.redialTimer_) return;
        const r = this.reconnect_!;
        this.redialDelay_ = this.redialDelay_ === 0 ? r.minDelayMs : Math.min(r.maxDelayMs, this.redialDelay_ * 2);
        this.redialTimer_ = setTimeout(() => {
            this.redialTimer_ = null;
            if (this.state_ !== 'reconnecting') return;
            // The server this client was on has not come back: log in at the
            // entry instead, which sends it where it belongs now.
            // The address being redialed has not come back: log in at the next
            // entry instead (the first after the lost server, then each in turn),
            // which sends it where it belongs now.
            if (this.entries_.length > 0 && this.dial_ && Date.now() - this.dialingSince_ >= this.entryAfterMs_) {
                this.entryAt_ = (this.entryAt_ + 1) % this.entries_.length;
                this.dialingSince_ = Date.now();
                this.offSocket_?.();
                this.offSocket_ = null;
                this.goBack_(this.entries_[this.entryAt_]!);
                return;
            }
            socket.connect();
        }, this.redialDelay_);
    }

    /** A hello answered with "not here": leave this link and say hello where it says. */
    private follow_(transport: ReliableOrderedTransport, redirect: { address: string; ticket?: string }): void {
        this.channel_?.dispose();
        this.channel_ = null;
        this.offSocket_?.();
        this.offSocket_ = null;
        this.cancelRedial_();
        if (isRedialable(transport)) transport.close(1000, 'redirected');
        this.beginTransfer_(redirect.address, redirect.ticket, this.entries_[0]);
    }

    private cancelRedial_(): void {
        if (this.redialTimer_) clearTimeout(this.redialTimer_);
        this.redialTimer_ = null;
    }

    /** @internal Keep the replay dt in lockstep with the app (plugin-fed). */
    setFixedDelta(dt: number): void {
        if (dt > 0) this.fixedDelta_ = dt;
    }

    get predictionEnabled(): boolean {
        return this.prediction_ !== null;
    }

    /**
     * Enable (or reconfigure) prediction after construction — the path for
     * game code whose connection a HOST made (the editor's multiplayer
     * preview connects the client realm itself, options-free): call from a
     * fixed-tick system once the session is a client. Owned entities that
     * already spawned get their authority copies seeded from current state.
     */
    enablePrediction(options: PredictionOptions): void {
        this.prediction_ = options;
        for (const e of this.ownedEntities_()) {
            const netId = this.netIds_.netIdOf(e);
            if (netId !== undefined && !this.authority_.has(netId)) {
                this.seedAuthority_(netId, e);
            }
        }
    }

    disconnect(): void {
        this.cancelRedial_();
        this.offSocket_?.();
        this.offSocket_ = null;
        this.channel_?.dispose();
        this.channel_ = null;
        this.connectionId_ = 0;
        this.setState_('closed');
        // Retire the despawn subscription and all accumulated state — otherwise
        // every Play→Stop / reconnect cycle leaks a closure that keeps this dead
        // client alive (and mutating it on future despawns), plus stale queues.
        this.offDespawn_?.();
        this.offDespawn_ = null;
        this.netIds_.clear();
        this.authority_.clear();
        this.inbox_.length = 0;
        this.pendingInputs_.length = 0;
    }

    /** Send an input command (typically the InputMap's evaluated action values,
     *  once per fixed tick — with prediction enabled that cadence is the
     *  contract, since the server consumes one command per tick). The seq
     *  stamp makes stale deliveries harmless. With prediction the command also
     *  applies to the owned entities immediately. */
    /**
     * Send a game message to the server (`ReplicationServer.onMessage`). Returns
     * false, and sends nothing, while not connected: a message is not queued
     * across a reconnect.
     */
    message(type: string, data?: unknown): boolean {
        if (!this.channel_ || this.state_ !== 'ready') return false;
        this.channel_.send<ReplGameMsg>(ReplMsg.message, data === undefined ? { type } : { type, data });
        return true;
    }

    /**
     * Hear a game message from the server (`ReplicationServer.message`), as it
     * arrives — not on the fixed step the state waits for. Returns an unsubscribe.
     */
    onMessage(type: string, handler: (data: unknown) => void): () => void {
        let set = this.messageHandlers_.get(type);
        if (!set) { set = new Set(); this.messageHandlers_.set(type, set); }
        set.add(handler);
        return () => { set!.delete(handler); };
    }

    sendInput(actions: Record<string, unknown>): void {
        if (!this.channel_) return;
        const msg: ReplInputMsg = { seq: ++this.inputSeq_, actions };
        this.channel_.send<ReplInputMsg>(ReplMsg.input, msg);
        if (!this.prediction_) return;
        this.pendingInputs_.push(msg);
        const cap = this.prediction_.maxPendingInputs ?? 120;
        if (this.pendingInputs_.length > cap) this.pendingInputs_.shift();
        for (const e of this.ownedEntities_()) {
            this.prediction_.apply(this.world_, e, actions, this.fixedDelta_);
        }
    }

    /** True when this client's connection owns the entity (Replicated.owner). */
    ownsEntity(entity: Entity): boolean {
        const repl = this.world_.tryGet(entity, Replicated) as { owner: number } | null;
        return repl !== null && repl.owner === this.connectionId_ && this.connectionId_ !== 0;
    }

    /** Apply everything received since the last fixed step, in the order it
     *  arrived — which is the order the authority sent it. Within one server
     *  tick that is already spawn → remove → despawn → state, so a frame never
     *  precedes the spawn it references and nothing has to be re-sorted here.
     *  With prediction enabled, ends by reconciling every owned entity:
     *  live state ← authority copy ⊕ replay of unacknowledged inputs. */
    applyPending(): void {
        while (this.inbox_.length > 0) {
            const op = this.inbox_.shift()!;
            switch (op.kind) {
                case 'spawn': this.applySpawnBatch_(op.batch); break;
                case 'despawn': this.applyDespawnBatch_(op.batch); break;
                case 'remove': this.applyComponentRemoveBatch_(op.batch); break;
                case 'state': this.applyStateFrame_(decodeStateFrame(op.frame, this.table, this.refs_)); break;
                case 'reset': this.resetWorld_(); break;
            }
        }
        if (this.prediction_) {
            while (this.pendingInputs_.length > 0 && this.pendingInputs_[0].seq <= this.ackedSeq_) {
                this.pendingInputs_.shift();
            }
            this.reconcilePredicted_();
        }
    }

    /** Rebuild every owned entity's live state as authority ⊕ pending replay
     *  (⊕ a decaying visual error when smoothing is on). Idempotent modulo the
     *  error decay — it runs unconditionally each fixed step. */
    private reconcilePredicted_(): void {
        const owned = this.ownedEntities_();
        if (owned.length === 0) return;

        // Smoothing: what the player SAW before this rebuild. The snap below
        // replaces field references (never mutates them), so these stay valid.
        const smoothing = this.prediction_!.smoothing;
        const seen = smoothing ? new Map<Entity, Map<number, Record<string, unknown>>>() : null;
        if (seen) {
            for (const e of owned) {
                const perComp = new Map<number, Record<string, unknown>>();
                for (const te of this.table.entries) {
                    if (!this.world_.has(e, te.def)) continue;
                    const data = this.world_.tryGet(e, te.def) as Record<string, unknown>;
                    const prev: Record<string, unknown> = {};
                    for (const f of te.fields) prev[f] = data[f];
                    perComp.set(te.id, prev);
                }
                seen.set(e, perComp);
            }
        }

        for (const e of owned) {
            const netId = this.netIds_.netIdOf(e);
            if (netId === undefined) continue;
            const perComp = this.authority_.get(netId);
            if (!perComp) continue;
            for (const [componentId, snap] of perComp) {
                const te = this.table.entries[componentId];
                if (!te) continue;
                const existing = this.world_.tryGet(e, te.def) as Record<string, unknown> | null;
                const target = existing ?? {};
                for (const f of te.fields) {
                    // Clone: replay mutates live objects in place; the
                    // authority copy must never alias them.
                    if (f in snap) target[f] = cloneValue(snap[f]);
                }
                if (existing) {
                    this.world_.set(e, te.def, target);
                } else {
                    this.world_.insert(e, te.def, target);
                }
            }
        }
        // Replay tick-by-tick across all owned entities — the same order the
        // server applies the queue to the connection's entities.
        for (const input of this.pendingInputs_) {
            for (const e of owned) {
                this.prediction_!.apply(this.world_, e, input.actions, this.fixedDelta_);
            }
        }

        // Smoothing: blend the rebuilt state toward what was on screen, with
        // the error halving every halfLife seconds. Next tick's rebuild wipes
        // it, so the error decays instead of compounding.
        if (smoothing && seen) {
            const keep = Math.pow(0.5, this.fixedDelta_ / smoothing.halfLife);
            const maxError = smoothing.maxError ?? Infinity;
            for (const e of owned) {
                // Annotated: some tsc releases flag this chain as circular
                // inference (TS7022) without them.
                const perComp: Map<number, Record<string, unknown>> | undefined = seen.get(e);
                if (!perComp) continue;
                for (const [componentId, prev] of perComp) {
                    const te: ReplicationTableEntry | undefined = this.table.entries[componentId];
                    if (!te || !this.world_.has(e, te.def)) continue;
                    const data = this.world_.tryGet(e, te.def) as Record<string, unknown>;
                    let changed = false;
                    for (let i = 0; i < te.fields.length; i++) {
                        const f = te.fields[i];
                        if (!(f in prev)) continue;
                        const blended = smoothValue(te.shapes[i], prev[f], data[f], keep, maxError);
                        if (blended !== data[f]) {
                            data[f] = blended;
                            changed = true;
                        }
                    }
                    if (changed) this.world_.set(e, te.def, data);
                }
            }
        }
    }

    private ownedEntities_(): Entity[] {
        const out: Entity[] = [];
        if (this.connectionId_ === 0) return out;
        for (const e of this.world_.getEntitiesWithComponents([Replicated])) {
            const repl = this.world_.tryGet(e, Replicated) as ReplicatedData | null;
            if (repl && repl.owner === this.connectionId_) out.push(e);
        }
        return out;
    }

    /** Whether this netId's state is under local prediction (owned + enabled). */
    private isPredicted_(netId: number): boolean {
        if (!this.prediction_) return false;
        const e = this.netIds_.entityOf(netId);
        if (e === undefined || !this.world_.valid(e)) return false;
        const repl = this.world_.tryGet(e, Replicated) as ReplicatedData | null;
        return repl !== null && repl.owner === this.connectionId_;
    }

    /**
     * Three phases, because a payload may name an entity that appears LATER in
     * the same batch — or itself. Register every netId before reading any
     * component data and every reference resolves; hydrating as it goes writes
     * 0 for a forward reference and never revisits it.
     */
    private applySpawnBatch_(batch: ReplSpawnBatch): void {
        if (batch.initial && this.resyncing_) {
            this.resyncing_ = false;
            this.reconcileHeld_(batch);
        }
        const fresh: { spawn: ReplSpawnEntity; entity: Entity }[] = [];
        for (const spawn of batch.entities) {
            if (this.netIds_.entityOf(spawn.netId) !== undefined) continue; // duplicate delivery
            // Refused BEFORE anything exists: a ghost the client cannot build is
            // not a ghost it should half-build, and a registered netId pointing
            // at a stripped entity would take deltas for the rest of the session.
            if (spawn.archetype !== '' && !getReplicationArchetype(spawn.archetype)) {
                log.error('repl', `no replication archetype registered for "${spawn.archetype}"`
                    + ` — refusing to construct netId ${spawn.netId}`);
                continue;
            }
            const e = this.world_.spawn(spawn.name || undefined);
            this.world_.insert(e, NetGhost, {});
            // Protocol identity, from the spawn rather than from a component the
            // authority happened to be holding.
            this.world_.insert(e, Replicated, {
                netId: spawn.netId, owner: spawn.owner, archetype: spawn.archetype,
            });
            this.netIds_.register(spawn.netId, e);
            fresh.push({ spawn, entity: e });
        }
        // Construction first, then the baseline on top: what the authority
        // declares outranks what the archetype defaults to, so an entity that
        // left interest and came back arrives at the current state.
        for (const { spawn, entity } of fresh) {
            if (spawn.archetype === '') continue;
            getReplicationArchetype(spawn.archetype)!(this.world_, entity);
        }
        for (const { spawn, entity } of fresh) {
            for (const comp of spawn.baseline) {
                const data = this.remapEntityRefs_(comp.type, comp.data);
                loadComponent(this.world_, entity, { type: comp.type, data }, spawn.name);
            }
        }
        // Baseline before hierarchy, as it has always been: reparenting runs
        // through the C++ registry and the prediction baseline must be the
        // state the authority sent, not whatever that leaves behind.
        for (const { spawn, entity } of fresh) this.seedAuthority_(spawn.netId, entity);
        for (const { spawn, entity } of fresh) {
            if (spawn.parentNetId === 0) continue;
            const parent = this.netIds_.entityOf(spawn.parentNetId);
            if (parent !== undefined) this.world_.setParent(entity, parent);
        }
    }

    /**
     * After a reconnect: the initial batch is everything the server says this
     * connection can see. A ghost it names stays the same entity and takes the
     * new baseline; one it does not name is gone. What is new falls through to
     * the ordinary spawn path, which skips the ones handled here.
     */
    private reconcileHeld_(batch: ReplSpawnBatch): void {
        const named = new Map<number, ReplSpawnEntity>();
        for (const spawn of batch.entities) named.set(spawn.netId, spawn);
        const gone: number[] = [];
        for (const netId of this.netIds_.netIdList()) if (!named.has(netId)) gone.push(netId);
        if (gone.length > 0) this.applyDespawnBatch_({ tick: batch.tick, netIds: gone });
        for (const spawn of batch.entities) {
            const e = this.netIds_.entityOf(spawn.netId);
            if (e === undefined || !this.world_.valid(e)) continue;
            this.world_.insert(e, Replicated, { netId: spawn.netId, owner: spawn.owner, archetype: spawn.archetype });
            this.interp_?.drop(spawn.netId);
            this.authority_.delete(spawn.netId);
            for (const comp of spawn.baseline) {
                const data = this.remapEntityRefs_(comp.type, comp.data);
                loadComponent(this.world_, e, { type: comp.type, data }, spawn.name);
            }
            this.seedAuthority_(spawn.netId, e);
        }
    }

    /** Seed the authority copy for a freshly spawned OWNED entity from its
     *  just-loaded state (the spawn payload IS the authoritative baseline). */
    private seedAuthority_(netId: number, e: Entity): void {
        if (!this.isPredicted_(netId)) return;
        const perComp = new Map<number, Record<string, unknown>>();
        for (const te of this.table.entries) {
            if (!this.world_.has(e, te.def)) continue;
            const data = this.world_.tryGet(e, te.def) as Record<string, unknown>;
            const snap: Record<string, unknown> = {};
            for (const f of te.fields) snap[f] = cloneValue(data[f]);
            perComp.set(te.id, snap);
        }
        this.authority_.set(netId, perComp);
    }

    private remapEntityRefs_(type: string, data: Record<string, unknown>): Record<string, unknown> {
        const entityFields = getComponent(type)?.entityFields ?? [];
        if (entityFields.length === 0) return { ...data };
        const out = { ...data };
        for (const f of entityFields) {
            if (typeof out[f] === 'number') {
                out[f] = (this.netIds_.entityOf(out[f] as number) as number | undefined) ?? 0;
            }
        }
        return out;
    }

    /** A replicated component left an entity that lives on. The ghost keeps
     *  existing; the component, its interpolation buffer and its authority
     *  snapshot all go. */
    private applyComponentRemoveBatch_(batch: ReplComponentRemoveBatch): void {
        for (const entry of batch.entries) {
            const e = this.netIds_.entityOf(entry.netId);
            for (const componentId of entry.componentIds) {
                const te = this.table.entries[componentId];
                if (!te) continue;
                this.interp_?.dropComponent(entry.netId, componentId);
                this.authority_.get(entry.netId)?.delete(componentId);
                if (e !== undefined && this.world_.valid(e) && this.world_.has(e, te.def)) {
                    this.world_.remove(e, te.def);
                }
            }
        }
    }

    private applyDespawnBatch_(batch: ReplDespawnBatch): void {
        for (const netId of batch.netIds) {
            const e = this.netIds_.entityOf(netId);
            this.netIds_.unregister(netId);
            this.interp_?.drop(netId);
            this.authority_.delete(netId);
            if (e !== undefined && this.world_.valid(e)) {
                this.world_.despawn(e);
            }
        }
    }

    private applyStateFrame_(frame: StateFrame): void {
        if (frame.tick > this.serverTick_) this.serverTick_ = frame.tick;
        for (const entry of frame.entries) {
            // Predicted (owned) entities: authoritative values land in the
            // authority copy — never the live components, never interpolation.
            // Reconciliation rebuilds the live state at the end of the flush.
            if (this.isPredicted_(entry.netId)) {
                this.updateAuthority_(entry.netId, entry.componentId, entry.fieldMask, entry.values);
                continue;
            }
            if (this.interp_) {
                let v = 0;
                const te = this.table.entries[entry.componentId];
                if (!te) continue;
                for (let i = 0; i < te.fields.length; i++) {
                    if (entry.fieldMask & (1 << i)) {
                        this.interp_.push(entry.netId, entry.componentId, i, frame.tick, entry.values[v++]);
                    }
                }
            } else {
                this.applyEntryNow_(entry.netId, entry.componentId, entry.fieldMask, entry.values);
            }
        }
    }

    private updateAuthority_(netId: number, componentId: number, fieldMask: number, values: unknown[]): void {
        const te = this.table.entries[componentId];
        if (!te) return;
        let perComp = this.authority_.get(netId);
        if (!perComp) {
            perComp = new Map();
            this.authority_.set(netId, perComp);
        }
        let snap = perComp.get(componentId);
        if (!snap) {
            snap = {};
            perComp.set(componentId, snap);
        }
        let v = 0;
        for (let i = 0; i < te.fields.length; i++) {
            if (fieldMask & (1 << i)) {
                snap[te.fields[i]] = values[v++];
            }
        }
    }

    private applyEntryNow_(netId: number, componentId: number, fieldMask: number, values: unknown[]): void {
        const e = this.netIds_.entityOf(netId);
        if (e === undefined || !this.world_.valid(e)) return;
        const te = this.table.entries[componentId];
        if (!te) return;
        const existing = this.world_.tryGet(e, te.def) as Record<string, unknown> | null;
        const target = existing ?? {};
        let v = 0;
        for (let i = 0; i < te.fields.length; i++) {
            if (fieldMask & (1 << i)) {
                target[te.fields[i]] = values[v++];
            }
        }
        if (existing) {
            this.world_.set(e, te.def, target);
        } else {
            this.world_.insert(e, te.def, target);
        }
    }

    /** Present the buffered state at the trailing render clock. Runs each
     *  render frame (PostUpdate); `deltaTicks` = render delta in tick units. */
    sampleInterpolation(deltaTicks: number): void {
        if (!this.interp_ || this.interp_.newestTick === 0) return;
        const t = this.interp_.advance(deltaTicks);
        for (const [netId, perComp] of this.interp_.buffers) {
            const e = this.netIds_.entityOf(netId);
            if (e === undefined || !this.world_.valid(e)) continue;
            for (const [componentId, buf] of perComp) {
                const te = this.table.entries[componentId];
                if (!te) continue;
                const existing = this.world_.tryGet(e, te.def) as Record<string, unknown> | null;
                const target = existing ?? {};
                let changed = false;
                for (const [fieldIndex, series] of buf.byField) {
                    const value = series.sample(te.shapes[fieldIndex], t);
                    if (value !== undefined) {
                        target[te.fields[fieldIndex]] = value;
                        changed = true;
                    }
                }
                if (!changed) continue;
                if (existing) {
                    this.world_.set(e, te.def, target);
                } else {
                    this.world_.insert(e, te.def, target);
                }
            }
        }
    }
}
