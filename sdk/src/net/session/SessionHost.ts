// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SessionHost.ts
 * @brief   The server end of a player session. It accepts connections from any
 *          transport, serves nothing but the hello until `authenticate` names the
 *          player, then serves the game's handlers with the player's context —
 *          behind frame limits, a rate limit, a heartbeat and a retry-safe
 *          request store. A host holds no game state: every handler gets the
 *          player from its context, so any number of hosts can run side by side.
 */
import {
    NetChannel,
    type PayloadCodec,
    type RequestCodec,
    type NetHeartbeatOptions,
    type NetLimitOptions,
    type NetTransport,
} from '../NetChannel';
import { MemoryIdempotencyStore, type IdempotencyStore } from '../IdempotencyStore';
import {
    SESSION_HELLO,
    SESSION_PROTOCOL_VERSION,
    SessionCloseCode,
    type SessionHelloRequest,
    type SessionHelloResponse,
} from './protocol';

/** One accepted connection, whatever carries it (a `ws` socket, a test pipe). */
export interface AcceptedConnection {
    transport: NetTransport;
    close(code?: number, reason?: string): void;
    /** Called once when the link is gone, from either side. */
    onClose(handler: () => void): () => void;
}

/** What `authenticate` returns: at least who the player is. */
export interface SessionContext {
    playerId: string;
}

/** Throw from `authenticate` to refuse a player with a message the client sees. */
export class SessionRejected extends Error {
    constructor(message: string, readonly fatal = true) {
        super(message);
        this.name = 'SessionRejected';
    }
}

export interface SessionHostOptions<Ctx extends SessionContext> {
    /** Turn the hello's credentials into a player, or throw {@link SessionRejected}. */
    authenticate(credentials: unknown, connection: AcceptedConnection): Ctx | Promise<Ctx>;
    /**
     * Where retried requests are remembered. The default lives in this process;
     * give hosts that share players one shared store, or a retry that lands on
     * another host runs twice.
     */
    idempotency?: IdempotencyStore;
    /** Ping each client; `false` turns it off. Default 15 s interval, 45 s timeout. */
    heartbeat?: { intervalMs: number; timeoutMs: number } | false;
    /** Default 64 KiB frames, 20 messages a second with a burst of 40. */
    limits?: Pick<NetLimitOptions, 'maxFrameBytes' | 'messagesPerSecond' | 'burst'>;
    /** Violations tolerated per minute before the connection is dropped. Default 100. */
    maxViolationsPerMinute?: number;
    /** A connection that has not said hello by now is closed. Default 5 s. */
    helloTimeoutMs?: number;
    /** Most connections at once; the next is refused. Default unlimited. */
    maxSessions?: number;
    /**
     * The encoding players speak after the hello. `'json'` (default) keeps text frames. `'pb'` gives protobuf to every
     * client that asks for it and still lets one ask for JSON, which is how a session is read in a debugger.
     * `'pb-only'` refuses a client that asks for JSON and drops JSON frames afterwards.
     */
    wire?: 'json' | 'pb' | 'pb-only';
    /** Request timeout the channels use for the host's own calls. Default 10 s. */
    requestTimeoutMs?: number;
}

export type SessionHandler<Ctx extends SessionContext, Req, Res> =
    (payload: Req, ctx: Ctx, session: ServerSession<Ctx>) => Res | Promise<Res>;

/** An authenticated player's connection, as a handler sees it. */
export interface ServerSession<Ctx extends SessionContext> {
    readonly ctx: Ctx;
    /** Fire-and-forget an event to this player. */
    push(type: string, payload: unknown, codec?: PayloadCodec<never>): void;
    close(code?: number, reason?: string): void;
}

interface Live<Ctx extends SessionContext> extends ServerSession<Ctx> {
    channel: NetChannel;
}

export class SessionHost<Ctx extends SessionContext = SessionContext> {
    private readonly options_: SessionHostOptions<Ctx>;
    private readonly store_: IdempotencyStore;
    private readonly handlers_ = new Map<string, { handler: SessionHandler<Ctx, never, unknown>; codec: RequestCodec<any, any> | undefined }>();
    private readonly byPlayer_ = new Map<string, Live<Ctx>>();
    private readonly connections_ = new Set<AcceptedConnection>();
    private closed_ = false;

    constructor(options: SessionHostOptions<Ctx>) {
        this.options_ = options;
        this.store_ = options.idempotency ?? new MemoryIdempotencyStore();
    }

    /** Connections currently open, authenticated or not. */
    get connectionCount(): number {
        return this.connections_.size;
    }

    /** Players with an authenticated connection to this host. */
    get playerCount(): number {
        return this.byPlayer_.size;
    }

    /**
     * Serve a request type to every authenticated player. Registered before or
     * after connections arrive; a connection sees the handlers present when its
     * hello succeeded.
     */
    handle<Req = unknown, Res = unknown>(type: string, handler: SessionHandler<Ctx, Req, Res>, codec?: RequestCodec<Req, Res>): () => void {
        if (type === SESSION_HELLO) throw new Error(`[net] "${SESSION_HELLO}" is the handshake and cannot be handled`);
        const entry = { handler: handler as SessionHandler<Ctx, never, unknown>, codec: codec as RequestCodec<any, any> | undefined };
        this.handlers_.set(type, entry);
        return () => {
            if (this.handlers_.get(type) === entry) this.handlers_.delete(type);
        };
    }

    /** Send an event to one player if they are connected to this host. */
    push(playerId: string, type: string, payload: unknown, codec?: PayloadCodec<never>): boolean {
        const live = this.byPlayer_.get(playerId);
        if (!live) return false;
        live.push(type, payload, codec);
        return true;
    }

    /**
     * Send an event to every authenticated player on this host. Across several
     * hosts, fan out through a shared bus and call this on each; a host does not
     * know about the others.
     */
    broadcast(type: string, payload: unknown, filter?: (ctx: Ctx) => boolean, codec?: PayloadCodec<never>): number {
        let sent = 0;
        for (const live of this.byPlayer_.values()) {
            if (filter && !filter(live.ctx)) continue;
            live.push(type, payload, codec);
            sent++;
        }
        return sent;
    }

    /** Take over one connection. Returns at once; everything after runs on events. */
    accept(connection: AcceptedConnection): void {
        const max = this.options_.maxSessions;
        if (this.closed_ || (max !== undefined && this.connections_.size >= max)) {
            connection.close(SessionCloseCode.unavailable, 'unavailable');
            return;
        }
        this.connections_.add(connection);

        const channel = this.makeChannel_(connection);
        let live: Live<Ctx> | null = null;
        let authenticating = false;
        const helloTimer = setTimeout(() => {
            if (!live) connection.close(SessionCloseCode.helloTimeout, 'hello timeout');
        }, this.options_.helloTimeoutMs ?? 5000);
        (helloTimer as { unref?: () => void }).unref?.();

        const offClose = connection.onClose(() => {
            clearTimeout(helloTimer);
            offClose();
            this.connections_.delete(connection);
            if (live && this.byPlayer_.get(live.ctx.playerId) === live) this.byPlayer_.delete(live.ctx.playerId);
            channel.dispose('connection closed');
        });

        channel.handle<SessionHelloRequest, SessionHelloResponse>(SESSION_HELLO, async (hello) => {
            if (live || authenticating) return { ok: false, error: 'already authenticated', fatal: false };
            if (!hello || hello.version !== SESSION_PROTOCOL_VERSION) {
                return { ok: false, error: `session protocol v${hello?.version}, server runs v${SESSION_PROTOCOL_VERSION}`, fatal: true };
            }
            const policy = this.options_.wire ?? 'json';
            const asked = hello.wire === 'pb' ? 'pb' : 'json';
            if (policy === 'pb-only' && asked !== 'pb') {
                return { ok: false, error: 'this server speaks protobuf only; the client asked for JSON', fatal: true };
            }
            const granted = policy !== 'json' && asked === 'pb' ? 'pb' : 'json';
            authenticating = true;
            try {
                const ctx = await this.options_.authenticate(hello.credentials, connection);
                if (typeof ctx?.playerId !== 'string' || ctx.playerId === '') {
                    return { ok: false, error: 'authentication produced no player', fatal: true };
                }
                if (!this.connections_.has(connection)) return { ok: false, error: 'connection closed', fatal: false };
                clearTimeout(helloTimer);
                live = this.admit_(connection, channel, ctx);
                channel.setWire(granted, { acceptJson: policy !== 'pb-only' });
                return { ok: true, playerId: ctx.playerId, serverTimeMs: Date.now(), wire: granted };
            } catch (err) {
                if (err instanceof SessionRejected) return { ok: false, error: err.message, fatal: err.fatal };
                return { ok: false, error: 'authentication unavailable', fatal: false };
            } finally {
                authenticating = false;
            }
        });
    }

    /** Close every connection and refuse new ones. */
    close(code: number = SessionCloseCode.unavailable, reason = 'shutting down'): void {
        this.closed_ = true;
        for (const connection of [...this.connections_]) connection.close(code, reason);
    }

    // -- internals ------------------------------------------------------------

    private makeChannel_(connection: AcceptedConnection): NetChannel {
        const o = this.options_;
        const beat = o.heartbeat === false ? undefined : (o.heartbeat ?? { intervalMs: 15_000, timeoutMs: 45_000 });
        const heartbeat: NetHeartbeatOptions | undefined = beat && {
            ...beat,
            onDead: () => connection.close(1001, 'heartbeat timeout'),
        };
        const budget = o.maxViolationsPerMinute ?? 100;
        let violations = 0;
        let windowStart = Date.now();
        return new NetChannel(connection.transport, {
            requestTimeoutMs: o.requestTimeoutMs,
            idempotency: this.store_,
            heartbeat,
            limits: {
                maxFrameBytes: o.limits?.maxFrameBytes ?? 64 * 1024,
                messagesPerSecond: o.limits?.messagesPerSecond ?? 20,
                burst: o.limits?.burst ?? 40,
                onViolation: () => {
                    const now = Date.now();
                    if (now - windowStart > 60_000) { windowStart = now; violations = 0; }
                    if (++violations > budget) connection.close(SessionCloseCode.abuse, 'rate limit');
                },
            },
        });
    }

    private admit_(connection: AcceptedConnection, channel: NetChannel, ctx: Ctx): Live<Ctx> {
        const previous = this.byPlayer_.get(ctx.playerId);
        const live: Live<Ctx> = {
            ctx,
            channel,
            push: (type, payload, codec) => channel.send(type, payload, codec as PayloadCodec | undefined),
            close: (code, reason) => connection.close(code, reason),
        };
        this.byPlayer_.set(ctx.playerId, live);
        // Replace after the swap, so the old link's own close does not delete the new entry.
        previous?.close(SessionCloseCode.replaced, 'replaced by a newer connection');

        channel.setIdempotencyScope(ctx.playerId);
        for (const [type, { handler, codec }] of this.handlers_) {
            channel.handle(type, (payload) => (handler as SessionHandler<Ctx, unknown, unknown>)(payload, ctx, live), codec);
        }
        return live;
    }
}
