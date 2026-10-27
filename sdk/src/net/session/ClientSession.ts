// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ClientSession.ts
 * @brief   The client end of a player session: one object a game holds for its
 *          whole run, however many times the link underneath drops. It dials,
 *          says hello, redials with backoff when the link is lost, and sends each
 *          request under a key so a retry after a lost reply never runs twice.
 *          Subscriptions made on the session survive every reconnect.
 */
import { NetChannel, NetRequestError, type MessageHandler } from '../NetChannel';
import type { PlatformSocket } from '../../platform/types';
import {
    SESSION_HELLO,
    SESSION_PROTOCOL_VERSION,
    SessionCloseCode,
    type SessionHelloRequest,
    type SessionHelloResponse,
} from './protocol';

export type SessionState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'closed';

export interface SessionBackoff {
    initialMs?: number;
    maxMs?: number;
    factor?: number;
    /** Fraction of each delay randomised away, 0 to 1. Spreads a crowd's redials. */
    jitter?: number;
}

export interface ClientSessionOptions {
    /** A fresh, unopened socket each call (`() => createSocket({ url })`). */
    connect: () => PlatformSocket;
    /** Sent in every hello, first dial and redial alike. */
    credentials: () => unknown | Promise<unknown>;
    /** Ping the server; `false` turns it off. Default 15 s interval, 45 s timeout. */
    heartbeat?: { intervalMs: number; timeoutMs: number } | false;
    backoff?: SessionBackoff;
    /** Extra sends of a request whose outcome was unknown or refused as retryable. Default 3. */
    retries?: number;
    /** Wait before the first retry; doubles each time. Default 300 ms. */
    retryDelayMs?: number;
    /** How long a request waits for the session to be ready before it fails. Default 15 s. */
    readyTimeoutMs?: number;
    /** Per-attempt timeout for a request. Default 10 s. */
    requestTimeoutMs?: number;
    /** Largest frame this side will accept from the server. Default 1 MiB. */
    maxFrameBytes?: number;
    /** For jitter; defaults to Math.random. */
    random?: () => number;
}

export interface SessionRequestOptions {
    /** Reuse a key across calls that mean the same intent; default a fresh one per call. */
    idempotencyKey?: string;
    timeoutMs?: number;
    /** Overrides the session's retry count for this call. 0 sends once. */
    retries?: number;
}

export interface SessionWelcome {
    playerId: string;
    data?: unknown;
}

type StateHandler = (state: SessionState, reason?: string) => void;

export class ClientSession {
    private readonly options_: ClientSessionOptions;
    private readonly listeners_ = new Map<string, Set<MessageHandler>>();
    private readonly stateHandlers_ = new Set<StateHandler>();
    private readonly readyWaiters_: { resolve: () => void; reject: (e: Error) => void }[] = [];
    private state_: SessionState = 'idle';
    private socket_: PlatformSocket | null = null;
    private channel_: NetChannel | null = null;
    private attached_ = new Set<string>();
    private attempt_ = 0;
    private lastClose_: { code: number } | null = null;
    private redialTimer_: ReturnType<typeof setTimeout> | null = null;
    private offsetMs_ = 0;
    private welcome_: SessionWelcome | null = null;
    private firstReady_: { resolve: (w: SessionWelcome) => void; reject: (e: Error) => void } | null = null;
    private keySeq_ = 0;
    private readonly keyPrefix_: string;

    constructor(options: ClientSessionOptions) {
        this.options_ = options;
        this.keyPrefix_ = Math.floor((options.random ?? Math.random)() * 0xffffffff).toString(36)
            + Date.now().toString(36);
    }

    get state(): SessionState {
        return this.state_;
    }

    /** Who the server says this is, once the first hello has succeeded. */
    get welcome(): SessionWelcome | null {
        return this.welcome_;
    }

    /**
     * How the last link ended, until the next one is ready: the WebSocket close code (4003 is the
     * server saying it is full or going away). Null while connected, or when no link has dropped yet.
     */
    get lastClose(): { code: number } | null {
        return this.lastClose_;
    }

    /** Dial attempts since the last time the session was ready; 0 when ready. */
    get attempts(): number {
        return this.attempt_;
    }

    /** The server's clock now, in epoch ms, corrected for this device's drift and the link's delay. */
    serverNow(): number {
        return Date.now() + this.offsetMs_;
    }

    /** Observe state changes. Returns an unsubscribe. */
    onState(handler: StateHandler): () => void {
        this.stateHandlers_.add(handler);
        return () => this.stateHandlers_.delete(handler);
    }

    /** Subscribe to a server-pushed event. Survives reconnects. */
    on<T = unknown>(type: string, handler: MessageHandler<T>): () => void {
        let set = this.listeners_.get(type);
        if (!set) { set = new Set(); this.listeners_.set(type, set); }
        set.add(handler as MessageHandler);
        this.attach_(type);
        return () => {
            const s = this.listeners_.get(type);
            if (s) { s.delete(handler as MessageHandler); if (s.size === 0) this.listeners_.delete(type); }
        };
    }

    /**
     * Dial and say hello. Resolves with the welcome once; later drops redial by
     * themselves. Rejects if the server refuses the player for good.
     */
    start(): Promise<SessionWelcome> {
        if (this.state_ !== 'idle') return Promise.reject(new Error(`[net] session already ${this.state_}`));
        return new Promise<SessionWelcome>((resolve, reject) => {
            this.firstReady_ = { resolve, reject };
            this.dial_();
        });
    }

    /** Fire-and-forget to the server. Dropped while the link is down. */
    send(type: string, payload: unknown): void {
        if (this.state_ === 'ready') this.channel_?.send(type, payload);
    }

    /**
     * Ask the server and wait for the answer. Waits for the session to be ready,
     * and when an attempt is lost or told to retry, sends it again under the same
     * key so the server answers once however many times it arrives.
     */
    async request<Res = unknown, Req = unknown>(type: string, payload: Req, options: SessionRequestOptions = {}): Promise<Res> {
        const key = options.idempotencyKey ?? `${this.keyPrefix_}-${(++this.keySeq_).toString(36)}`;
        const retries = options.retries ?? this.options_.retries ?? 3;
        let delay = this.options_.retryDelayMs ?? 300;
        for (let attempt = 0; ; attempt++) {
            await this.whenReady_();
            try {
                return await this.channel_!.request<Res, Req>(type, payload, {
                    idempotencyKey: key,
                    timeoutMs: options.timeoutMs ?? this.options_.requestTimeoutMs,
                });
            } catch (err) {
                const retryable = err instanceof NetRequestError && err.retryable;
                if (!retryable || attempt >= retries) throw err;
                await sleep(delay);
                delay *= 2;
            }
        }
    }

    /**
     * Redial now instead of waiting out the backoff, for a player who pressed "try again". Does nothing
     * while a dial is already under way, when the session is ready, or once it has closed for good.
     */
    retryNow(): void {
        if (this.redialTimer_ === null) return;
        clearTimeout(this.redialTimer_);
        this.redialTimer_ = null;
        this.dial_();
    }

    /** Leave for good: no redial, requests in flight fail. */
    close(): void {
        if (this.state_ === 'closed') return;
        this.finish_('closed by the game');
    }

    // -- internals ------------------------------------------------------------

    private setState_(state: SessionState, reason?: string): void {
        if (this.state_ === state) return;
        this.state_ = state;
        for (const h of [...this.stateHandlers_]) h(state, reason);
    }

    private attach_(type: string): void {
        const channel = this.channel_;
        if (!channel || this.attached_.has(type)) return;
        this.attached_.add(type);
        channel.on(type, (payload) => {
            for (const h of [...(this.listeners_.get(type) ?? [])]) h(payload);
        });
    }

    private dial_(): void {
        if (this.state_ === 'closed') return;
        this.setState_(this.welcome_ ? 'reconnecting' : 'connecting');
        this.attempt_++;
        let socket: PlatformSocket;
        try {
            socket = this.options_.connect();
        } catch {
            this.scheduleRedial_();
            return;
        }
        this.socket_ = socket;
        let lost = false;
        const onLost = (code: number): void => {
            if (lost) return;
            lost = true;
            this.linkLost_(socket, code);
        };
        socket.on('open', () => void this.hello_(socket));
        socket.on('close', onLost);
        // A dial that fails outright can report only an error and never a close.
        socket.on('error', () => { if (socket.readyState === 'closed') onLost(1006); });
        socket.connect();
    }

    private async hello_(socket: PlatformSocket): Promise<void> {
        const o = this.options_;
        const beat = o.heartbeat === false ? undefined : (o.heartbeat ?? { intervalMs: 15_000, timeoutMs: 45_000 });
        const channel = new NetChannel(socket, {
            requestTimeoutMs: o.requestTimeoutMs,
            heartbeat: beat && { ...beat, onDead: () => socket.close(4000, 'heartbeat timeout') },
            limits: { maxFrameBytes: o.maxFrameBytes ?? 1024 * 1024 },
        });
        this.channel_ = channel;
        this.attached_ = new Set();
        for (const type of this.listeners_.keys()) this.attach_(type);
        try {
            const credentials = await o.credentials();
            const sent = Date.now();
            const res = await channel.request<SessionHelloResponse, SessionHelloRequest>(
                SESSION_HELLO, { version: SESSION_PROTOCOL_VERSION, credentials }, o.requestTimeoutMs,
            );
            if (this.channel_ !== channel) return;
            if (!res.ok) {
                if (res.fatal) this.finish_(res.error);
                else socket.close(1000, 'hello refused');
                return;
            }
            const received = Date.now();
            this.offsetMs_ = res.serverTimeMs + (received - sent) / 2 - received;
            this.welcome_ = { playerId: res.playerId, data: res.data };
            this.attempt_ = 0;
            this.lastClose_ = null;
            this.setState_('ready');
            for (const w of this.readyWaiters_.splice(0)) w.resolve();
            this.firstReady_?.resolve(this.welcome_);
            this.firstReady_ = null;
        } catch {
            // A hello that never came back is a dead link; closing hands it to the redial.
            if (this.channel_ === channel) socket.close(1000, 'hello failed');
        }
    }

    private linkLost_(socket: PlatformSocket, code: number): void {
        if (this.socket_ !== socket) return;
        this.channel_?.dispose('session link lost');
        this.channel_ = null;
        this.socket_ = null;
        if (this.state_ === 'closed') return;
        this.lastClose_ = { code };
        if (code === SessionCloseCode.replaced) {
            // Another device took the player; fighting it would trade the seat back and forth.
            this.finish_('replaced by a newer connection');
            return;
        }
        this.scheduleRedial_();
    }

    private scheduleRedial_(): void {
        if (this.state_ === 'closed') return;
        this.setState_(this.welcome_ ? 'reconnecting' : 'connecting');
        const b = this.options_.backoff ?? {};
        const base = Math.min(b.maxMs ?? 30_000, (b.initialMs ?? 500) * (b.factor ?? 2) ** Math.max(0, this.attempt_ - 1));
        const jitter = b.jitter ?? 0.3;
        const delay = base * (1 - jitter * (this.options_.random ?? Math.random)());
        this.redialTimer_ = setTimeout(() => { this.redialTimer_ = null; this.dial_(); }, delay);
    }

    private whenReady_(): Promise<void> {
        if (this.state_ === 'ready') return Promise.resolve();
        if (this.state_ === 'closed') return Promise.reject(new Error('[net] the session is closed'));
        return new Promise<void>((resolve, reject) => {
            const waiter = { resolve, reject };
            const timer = setTimeout(() => {
                const i = this.readyWaiters_.indexOf(waiter);
                if (i >= 0) this.readyWaiters_.splice(i, 1);
                reject(new Error('[net] the session did not become ready in time'));
            }, this.options_.readyTimeoutMs ?? 15_000);
            waiter.resolve = () => { clearTimeout(timer); resolve(); };
            waiter.reject = (e) => { clearTimeout(timer); reject(e); };
            this.readyWaiters_.push(waiter);
        });
    }

    private finish_(reason: string): void {
        if (this.redialTimer_) { clearTimeout(this.redialTimer_); this.redialTimer_ = null; }
        const socket = this.socket_;
        this.socket_ = null;
        this.channel_?.dispose('session closed');
        this.channel_ = null;
        this.setState_('closed', reason);
        socket?.close(1000, 'closed');
        const err = new Error(`[net] session closed: ${reason}`);
        for (const w of this.readyWaiters_.splice(0)) w.reject(err);
        this.firstReady_?.reject(err);
        this.firstReady_ = null;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
