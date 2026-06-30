// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NetChannel.ts
 * @brief   A typed message + request/response layer over a raw socket. The raw
 *          GameSocket / WeChatSocket only move string|ArrayBuffer frames; this
 *          is the single channel that gives them typed events (`on`/`send`) and
 *          RPC (`handle`/`request`) with a small JSON envelope. Transport-
 *          agnostic — anything that can `send` and surface `onMessage` works.
 */

/** The minimal socket surface NetChannel drives (GameSocket / WeChatSocket fit). */
export interface NetTransport {
    send(data: string | ArrayBuffer): void;
    onMessage: ((data: string | ArrayBuffer) => void) | null;
}

export type MessageHandler<T = unknown> = (payload: T) => void;
export type RequestHandler<Req = unknown, Res = unknown> = (payload: Req) => Res | Promise<Res>;

export interface NetChannelOptions {
    /** Default RPC timeout in ms (0 disables). Default 10000. */
    requestTimeoutMs?: number;
}

interface WireEvent { k: 'event'; t: string; d: unknown; }
interface WireReq { k: 'req'; t: string; id: number; d: unknown; }
interface WireRes { k: 'res'; id: number; d?: unknown; e?: string; }
type Wire = WireEvent | WireReq | WireRes;

interface Pending {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Typed messaging over a {@link NetTransport}. Claims the transport's
 * `onMessage` (it is the message router). Events are fire-and-forget; requests
 * await a matching response by id (or reject on timeout / remote error).
 * Binary frames are ignored — the envelope is JSON text.
 */
export class NetChannel {
    private readonly transport: NetTransport;
    private readonly handlers = new Map<string, Set<MessageHandler>>();
    private readonly requestHandlers = new Map<string, RequestHandler>();
    private readonly pending = new Map<number, Pending>();
    private readonly defaultTimeout: number;
    private nextId = 1;

    constructor(transport: NetTransport, opts: NetChannelOptions = {}) {
        this.transport = transport;
        this.defaultTimeout = opts.requestTimeoutMs ?? 10000;
        transport.onMessage = (data) => this.handleIncoming_(data);
    }

    /** Subscribe to a typed event. Returns an unsubscribe function. */
    on<T = unknown>(type: string, handler: MessageHandler<T>): () => void {
        let set = this.handlers.get(type);
        if (!set) { set = new Set(); this.handlers.set(type, set); }
        set.add(handler as MessageHandler);
        return () => {
            const s = this.handlers.get(type);
            if (s) { s.delete(handler as MessageHandler); if (s.size === 0) this.handlers.delete(type); }
        };
    }

    /** Fire-and-forget a typed event to the peer. */
    send<T = unknown>(type: string, payload: T): void {
        this.send_({ k: 'event', t: type, d: payload });
    }

    /** Register the single handler that answers `request(type, …)` from the peer.
     *  Returns an unregister function. */
    handle<Req = unknown, Res = unknown>(type: string, handler: RequestHandler<Req, Res>): () => void {
        this.requestHandlers.set(type, handler as RequestHandler);
        return () => {
            if (this.requestHandlers.get(type) === (handler as RequestHandler)) {
                this.requestHandlers.delete(type);
            }
        };
    }

    /** Send a request and await the peer's response (rejects on timeout / remote error). */
    request<Res = unknown, Req = unknown>(type: string, payload: Req, timeoutMs?: number): Promise<Res> {
        const id = this.nextId++;
        const limit = timeoutMs ?? this.defaultTimeout;
        return new Promise<Res>((resolve, reject) => {
            const timer = limit > 0
                ? setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error(`net request "${type}" timed out after ${limit}ms`));
                }, limit)
                : null;
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
            this.send_({ k: 'req', t: type, id, d: payload });
        });
    }

    /** Reject all in-flight requests and drop handlers (call on disconnect). */
    dispose(reason = 'net channel closed'): void {
        for (const [, p] of this.pending) {
            if (p.timer) clearTimeout(p.timer);
            p.reject(new Error(reason));
        }
        this.pending.clear();
        this.handlers.clear();
        this.requestHandlers.clear();
    }

    // -- internals ------------------------------------------------------------

    private send_(wire: Wire): void {
        this.transport.send(JSON.stringify(wire));
    }

    private handleIncoming_(data: string | ArrayBuffer): void {
        if (typeof data !== 'string') return; // JSON-text envelope only
        let msg: Wire;
        try { msg = JSON.parse(data) as Wire; } catch { return; }
        if (!msg || typeof (msg as { k?: unknown }).k !== 'string') return;
        switch (msg.k) {
            case 'event': this.dispatchEvent_(msg.t, msg.d); break;
            case 'req': this.handleRequest_(msg); break;
            case 'res': this.resolvePending_(msg); break;
        }
    }

    private dispatchEvent_(type: string, payload: unknown): void {
        const set = this.handlers.get(type);
        if (!set) return;
        for (const h of [...set]) h(payload);
    }

    private handleRequest_(msg: WireReq): void {
        const handler = this.requestHandlers.get(msg.t);
        if (!handler) {
            this.send_({ k: 'res', id: msg.id, e: `no request handler for "${msg.t}"` });
            return;
        }
        Promise.resolve()
            .then(() => handler(msg.d))
            .then(
                (result) => this.send_({ k: 'res', id: msg.id, d: result }),
                (err) => this.send_({ k: 'res', id: msg.id, e: err instanceof Error ? err.message : String(err) }),
            );
    }

    private resolvePending_(msg: WireRes): void {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (p.timer) clearTimeout(p.timer);
        if (msg.e !== undefined) p.reject(new Error(msg.e));
        else p.resolve(msg.d);
    }
}
