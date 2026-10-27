// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NetChannel.ts
 * @brief   A typed message + request/response layer over a raw socket. The raw
 *          GameSocket / WeChatSocket only move string|ArrayBuffer frames; this
 *          is the single channel that gives them typed events (`on`/`send`) and
 *          RPC (`handle`/`request`) with a small JSON envelope. Transport-
 *          agnostic — anything that can `send` and surface `message` events works.
 */
import type { IdempotencyStore } from './IdempotencyStore';
import { CONTROL_CHANNEL, decodeEnvelope, encodeEnvelope, type Envelope, type PayloadCodec, type WireFormat } from './wire';

export type { PayloadCodec, WireFormat } from './wire';

/** The codecs of one request: how its payload and its answer travel. */
export interface RequestCodec<Req = unknown, Res = unknown> {
    req: PayloadCodec<Req>;
    res: PayloadCodec<Res>;
}

/** The minimal socket surface NetChannel drives (GameSocket / WeChatSocket fit). */
export interface NetTransport {
    send(data: string | ArrayBuffer): void;
    /** Subscribe to incoming frames. Returns an unsubscribe function. */
    on(event: 'message', handler: (data: string | ArrayBuffer) => void): () => void;
}

/**
 * A transport that delivers every frame, once, in send order. {@link NetChannel}
 * needs no such promise; replication does — its client applies the inbox in
 * ARRIVAL order because that IS the authority's order. Declaring the marker is
 * a claim about the link, not a feature to switch on.
 */
export interface ReliableOrderedTransport extends NetTransport {
    readonly delivery: 'reliable-ordered';
}

export type MessageHandler<T = unknown> = (payload: T) => void;
export type RequestHandler<Req = unknown, Res = unknown> = (payload: Req) => Res | Promise<Res>;
export type BinaryHandler = (payload: Uint8Array) => void;

/** What the peer answers when it refuses a message for coming too fast. */
export const NET_RATE_LIMITED = 'rate limited';
/** What the peer answers a retry whose first attempt threw: the key is free, send it again. */
export const NET_ATTEMPT_FAILED = 'the first attempt failed, retry';

/**
 * Why a request did not return a value.
 *
 * - `timeout`: no answer in time; the peer may or may not have run it.
 * - `closed`: the channel went away with the request in flight; same doubt.
 * - `rate-limited` / `retry`: the peer ran nothing and says to send it again.
 * - `remote`: the peer's handler threw, or has none; its message is in `message`.
 */
export type NetRequestErrorCode = 'timeout' | 'closed' | 'rate-limited' | 'retry' | 'remote';

export class NetRequestError extends Error {
    constructor(message: string, readonly code: NetRequestErrorCode) {
        super(message);
        this.name = 'NetRequestError';
    }

    /** True when sending the same request again, with the same key, is safe. */
    get retryable(): boolean {
        return this.code !== 'remote';
    }
}

/** Why a channel dropped or refused something the peer sent. */
export type NetViolation = 'frame-size' | 'rate' | 'wire';

export interface NetHeartbeatOptions {
    /** How often to ping the peer. */
    intervalMs: number;
    /** Silence longer than this (no frame of any kind) means the peer is gone. */
    timeoutMs: number;
    /** Called once, when the peer has been silent for `timeoutMs`. */
    onDead: () => void;
}

export interface NetLimitOptions {
    /** Larger frames are dropped before they are parsed. Binary frames count too. */
    maxFrameBytes?: number;
    /** Sustained control messages (events and requests) per second. Binary frames are not limited. */
    messagesPerSecond?: number;
    /** Messages allowed at once before the sustained rate applies. Default: one second's worth. */
    burst?: number;
    /** Called for every dropped frame or refused message. */
    onViolation?: (kind: NetViolation) => void;
}

export interface NetChannelOptions {
    /** Default RPC timeout in ms (0 disables). Default 10000. */
    requestTimeoutMs?: number;
    /**
     * Answer a retried request from memory. Only requests that carry a key
     * (`idempotencyKey` on the sender) are looked up; the rest run as before.
     */
    idempotency?: IdempotencyStore;
    /** Prefixes every key so two players cannot collide on one. Usually the player id. */
    idempotencyScope?: string;
    /** Ping the peer and report when it goes silent. */
    heartbeat?: NetHeartbeatOptions;
    limits?: NetLimitOptions;
}

export interface RequestOptions {
    /** RPC timeout in ms (0 disables). */
    timeoutMs?: number;
    /**
     * Names this intent. A retry with the same key gets the first attempt's
     * answer instead of running the handler again. One key per intent (one
     * click), not per attempt.
     */
    idempotencyKey?: string;
    /** How the payload and the answer travel on the protobuf wire; the JSON wire carries their JSON form. */
    codec?: RequestCodec<any, any>;
}

interface WireEvent { k: 'event'; t: string; d: unknown; }
interface WireReq { k: 'req'; t: string; id: number; d: unknown; ik?: string; }
interface WireRes { k: 'res'; id: number; d?: unknown; e?: string; }
interface WirePing { k: 'ping'; n: number; }
interface WirePong { k: 'pong'; n: number; }
type Wire = WireEvent | WireReq | WireRes | WirePing | WirePong;

interface Pending {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
    codec: PayloadCodec | undefined;
}

/** A control message as it arrived, whichever wire it came on; `payload` reads the value with the codec the handler knows. */
interface Incoming {
    k: Wire['k'];
    t?: string;
    id?: number;
    ik?: string;
    e?: string;
    n?: number;
    hasPayload: boolean;
    payload(codec: PayloadCodec | undefined): unknown;
}

const utf8 = new TextEncoder();
const utf8Back = new TextDecoder();

/**
 * Typed messaging over a {@link NetTransport}. Subscribes to the transport's
 * `message` events (it is the message router). Events are fire-and-forget;
 * requests await a matching response by id (or reject on timeout / remote
 * error).
 *
 * Two planes share the one transport: string frames carry the JSON control
 * envelope; binary frames carry a 1-byte channel id + payload for high-rate
 * data (replication snapshots claim channel 1). A binary frame with no
 * registered channel handler is dropped.
 */
export class NetChannel {
    private readonly transport: NetTransport;
    private readonly handlers = new Map<string, Set<MessageHandler>>();
    private readonly requestHandlers = new Map<string, { handler: RequestHandler; codec: RequestCodec<any, any> | undefined }>();
    private readonly eventCodecs = new Map<string, PayloadCodec>();
    private wire_: WireFormat = 'json';
    private jsonAllowed_ = true;
    private readonly binaryHandlers = new Map<number, BinaryHandler>();
    private readonly pending = new Map<number, Pending>();
    private readonly defaultTimeout: number;
    private readonly offMessage_: () => void;
    private readonly idempotency_: IdempotencyStore | undefined;
    private scope_: string;
    private readonly limits_: NetLimitOptions;
    private readonly bucketCapacity_: number;
    private heartbeatTimer_: ReturnType<typeof setInterval> | null = null;
    private bucket_: number;
    private bucketAt_ = Date.now();
    private lastHeard_ = Date.now();
    private nextId = 1;
    private nextPing_ = 1;

    constructor(transport: NetTransport, opts: NetChannelOptions = {}) {
        this.transport = transport;
        this.defaultTimeout = opts.requestTimeoutMs ?? 10000;
        this.idempotency_ = opts.idempotency;
        this.scope_ = opts.idempotencyScope ?? '';
        this.limits_ = opts.limits ?? {};
        const rate = this.limits_.messagesPerSecond ?? 0;
        this.bucketCapacity_ = rate > 0 ? Math.max(1, this.limits_.burst ?? rate) : 0;
        this.bucket_ = this.bucketCapacity_;
        this.offMessage_ = transport.on('message', (data) => this.handleIncoming_(data));
        if (opts.heartbeat) this.startHeartbeat_(opts.heartbeat);
    }

    /** Subscribe to a typed event. Returns an unsubscribe function. */
    on<T = unknown>(type: string, handler: MessageHandler<T>, codec?: PayloadCodec<T>): () => void {
        if (codec) this.eventCodecs.set(type, codec as PayloadCodec);
        let set = this.handlers.get(type);
        if (!set) { set = new Set(); this.handlers.set(type, set); }
        set.add(handler as MessageHandler);
        return () => {
            const s = this.handlers.get(type);
            if (s) { s.delete(handler as MessageHandler); if (s.size === 0) this.handlers.delete(type); }
        };
    }

    /** Fire-and-forget a typed event to the peer. */
    send<T = unknown>(type: string, payload: T, codec?: PayloadCodec<T>): void {
        this.send_({ k: 'event', t: type, d: payload }, codec as PayloadCodec | undefined);
    }

    /** The encoding this channel writes. It reads both. */
    get wire(): WireFormat {
        return this.wire_;
    }

    /**
     * Choose what this channel writes from now on. `acceptJson: false` makes it refuse JSON frames
     * from the peer (counted as a `wire` violation), for a server that has agreed on protobuf.
     */
    setWire(format: WireFormat, options: { acceptJson?: boolean } = {}): void {
        this.wire_ = format;
        this.jsonAllowed_ = options.acceptJson ?? true;
    }

    /** Register the single handler that answers `request(type, …)` from the peer.
     *  Returns an unregister function. */
    handle<Req = unknown, Res = unknown>(type: string, handler: RequestHandler<Req, Res>, codec?: RequestCodec<Req, Res>): () => void {
        const entry = { handler: handler as RequestHandler, codec: codec as RequestCodec<any, any> | undefined };
        this.requestHandlers.set(type, entry);
        return () => {
            if (this.requestHandlers.get(type) === entry) {
                this.requestHandlers.delete(type);
            }
        };
    }

    /**
     * Send a request and await the peer's response (rejects on timeout / remote
     * error). A number is the timeout in ms; an options object adds an
     * idempotency key.
     */
    request<Res = unknown, Req = unknown>(type: string, payload: Req, options?: number | RequestOptions): Promise<Res> {
        const id = this.nextId++;
        const opts: RequestOptions = typeof options === 'number' ? { timeoutMs: options } : options ?? {};
        const limit = opts.timeoutMs ?? this.defaultTimeout;
        return new Promise<Res>((resolve, reject) => {
            const timer = limit > 0
                ? setTimeout(() => {
                    this.pending.delete(id);
                    reject(new NetRequestError(`net request "${type}" timed out after ${limit}ms`, 'timeout'));
                }, limit)
                : null;
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, codec: opts.codec?.res });
            const wire: WireReq = { k: 'req', t: type, id, d: payload };
            if (opts.idempotencyKey !== undefined) wire.ik = opts.idempotencyKey;
            this.send_(wire, opts.codec?.req);
        });
    }

    /** Register the single handler for a binary channel id (0-254; 255 carries control messages on the protobuf wire). Returns an
     *  unregister function. */
    onBinary(channel: number, handler: BinaryHandler): () => void {
        if (channel === CONTROL_CHANNEL) throw new RangeError(`[net] binary channel ${CONTROL_CHANNEL} is reserved for control messages`);
        this.binaryHandlers.set(channel, handler);
        return () => {
            if (this.binaryHandlers.get(channel) === handler) {
                this.binaryHandlers.delete(channel);
            }
        };
    }

    /** Fire-and-forget a binary payload on a channel id (0-254; 255 carries control messages on the protobuf wire). */
    sendBinary(channel: number, payload: Uint8Array): void {
        if (channel === CONTROL_CHANNEL) throw new RangeError(`[net] binary channel ${CONTROL_CHANNEL} is reserved for control messages`);
        const frame = new Uint8Array(1 + payload.byteLength);
        frame[0] = channel;
        frame.set(payload, 1);
        this.transport.send(frame.buffer);
    }

    /**
     * Scope later idempotency keys to this owner. A server knows the player only
     * after the hello, so the scope is set once the connection has authenticated.
     */
    setIdempotencyScope(scope: string): void {
        this.scope_ = scope;
    }

    /** Reject all in-flight requests and drop handlers (call on disconnect). */
    dispose(reason = 'net channel closed'): void {
        this.offMessage_();
        if (this.heartbeatTimer_) { clearInterval(this.heartbeatTimer_); this.heartbeatTimer_ = null; }
        for (const [, p] of this.pending) {
            if (p.timer) clearTimeout(p.timer);
            p.reject(new NetRequestError(reason, 'closed'));
        }
        this.pending.clear();
        this.handlers.clear();
        this.requestHandlers.clear();
        this.binaryHandlers.clear();
    }

    // -- internals ------------------------------------------------------------

    /** Write one control message in this channel's wire; `codec` is how its payload travels. */
    private send_(wire: Wire, codec?: PayloadCodec): void {
        const value = 'd' in wire ? wire.d : undefined;
        if (this.wire_ === 'json') {
            if (codec && value !== undefined) (wire as { d?: unknown }).d = codec.toJSON(value);
            this.transport.send(JSON.stringify(wire));
            return;
        }
        const e: Envelope = { kind: wire.k };
        if ('t' in wire) e.type = wire.t;
        if (wire.k === 'req' || wire.k === 'res') e.id = wire.id;
        if (wire.k === 'ping' || wire.k === 'pong') e.id = wire.n;
        if (wire.k === 'req' && wire.ik !== undefined) e.key = wire.ik;
        if (wire.k === 'res' && wire.e !== undefined) e.error = wire.e;
        if (value !== undefined) e.payload = codec ? codec.encode(value) : utf8.encode(JSON.stringify(value));
        this.transport.send(encodeEnvelope(e));
    }

    private startHeartbeat_(beat: NetHeartbeatOptions): void {
        const timer = setInterval(() => {
            if (Date.now() - this.lastHeard_ > beat.timeoutMs) {
                clearInterval(timer);
                this.heartbeatTimer_ = null;
                beat.onDead();
                return;
            }
            this.send_({ k: 'ping', n: this.nextPing_++ });
        }, beat.intervalMs);
        // A heartbeat must not keep a server process alive by itself.
        (timer as { unref?: () => void }).unref?.();
        this.heartbeatTimer_ = timer;
    }

    /** Spend one message from the bucket; false when the peer is over its rate. */
    private admit_(): boolean {
        if (this.bucketCapacity_ === 0) return true;
        const now = Date.now();
        const refill = ((now - this.bucketAt_) / 1000) * (this.limits_.messagesPerSecond ?? 0);
        this.bucketAt_ = now;
        this.bucket_ = Math.min(this.bucketCapacity_, this.bucket_ + refill);
        if (this.bucket_ < 1) return false;
        this.bucket_ -= 1;
        return true;
    }

    private handleIncoming_(data: string | ArrayBuffer): void {
        this.lastHeard_ = Date.now();
        const max = this.limits_.maxFrameBytes;
        if (max !== undefined) {
            // A string's length counts UTF-16 units, not bytes; the bound only has
            // to keep a hostile frame from being parsed, not measure it exactly.
            const size = typeof data === 'string' ? data.length : data.byteLength;
            if (size > max) { this.limits_.onViolation?.('frame-size'); return; }
        }
        let msg: Incoming | null;
        if (typeof data !== 'string') {
            const view = new Uint8Array(data);
            if (view.byteLength === 0) return;
            if (view[0] !== CONTROL_CHANNEL) {
                this.binaryHandlers.get(view[0]!)?.(view.subarray(1));
                return;
            }
            msg = incomingFromEnvelope(decodeEnvelope(view.subarray(1)));
        } else {
            if (!this.jsonAllowed_) { this.limits_.onViolation?.('wire'); return; }
            msg = incomingFromJson(data);
        }
        if (!msg) return;
        switch (msg.k) {
            case 'ping': this.send_({ k: 'pong', n: msg.n ?? 0 }); break;
            case 'pong': break;
            case 'event':
                if (!this.admit_()) { this.limits_.onViolation?.('rate'); break; }
                this.dispatchEvent_(msg);
                break;
            case 'req':
                if (!this.admit_()) {
                    this.limits_.onViolation?.('rate');
                    this.send_({ k: 'res', id: msg.id ?? 0, e: NET_RATE_LIMITED });
                    break;
                }
                this.handleRequest_(msg);
                break;
            case 'res': this.resolvePending_(msg); break;
        }
    }

    private dispatchEvent_(msg: Incoming): void {
        const type = msg.t ?? '';
        const set = this.handlers.get(type);
        if (!set) return;
        let payload: unknown;
        try { payload = msg.payload(this.eventCodecs.get(type)); } catch { return; }
        for (const h of [...set]) h(payload);
    }

    private handleRequest_(msg: Incoming): void {
        const type = msg.t ?? '';
        const id = msg.id ?? 0;
        const entry = this.requestHandlers.get(type);
        if (!entry) {
            this.send_({ k: 'res', id, e: `no request handler for "${type}"` });
            return;
        }
        let payload: unknown;
        try { payload = msg.payload(entry.codec?.req); } catch (err) {
            this.send_({ k: 'res', id, e: `invalid ${type} request: ${errorText(err)}` });
            return;
        }
        const store = this.idempotency_;
        if (store && typeof msg.ik === 'string') {
            void this.handleIdempotent_(store, `${this.scope_}\u0000${type}\u0000${msg.ik}`, entry, id, payload);
            return;
        }
        Promise.resolve()
            .then(() => entry.handler(payload))
            .then(
                (result) => this.send_({ k: 'res', id, d: result }, entry.codec?.res),
                (err) => this.send_({ k: 'res', id, e: errorText(err) }),
            );
    }

    /**
     * Run a keyed request at most once to completion. A handler that returns has
     * its answer kept, so a retry replays it; one that throws frees the key and
     * the retry runs again — a business refusal belongs in the return value.
     * The answer is kept in its JSON form, which any store can hold and either wire can rebuild.
     */
    private async handleIdempotent_(
        store: IdempotencyStore, key: string, entry: { handler: RequestHandler; codec: RequestCodec<any, any> | undefined }, id: number, payload: unknown,
    ): Promise<void> {
        const res = entry.codec?.res;
        const replay = (stored: unknown): void => {
            let value: unknown = stored;
            if (res && stored !== undefined) {
                try { value = res.fromJSON(stored); } catch (err) { this.send_({ k: 'res', id, e: errorText(err) }); return; }
            }
            this.send_({ k: 'res', id, d: value }, res);
        };
        try {
            const begin = await store.begin(key);
            if (begin.state === 'done') {
                replay(begin.outcome.d);
                return;
            }
            if (begin.state === 'busy') {
                const outcome = await begin.outcome;
                if (outcome) replay(outcome.d);
                else this.send_({ k: 'res', id, e: NET_ATTEMPT_FAILED });
                return;
            }
            let result: unknown;
            try {
                result = await entry.handler(payload);
            } catch (err) {
                await store.abandon(key);
                this.send_({ k: 'res', id, e: errorText(err) });
                return;
            }
            await store.finish(key, { d: res && result !== undefined ? res.toJSON(result) : result });
            this.send_({ k: 'res', id, d: result }, res);
        } catch (err) {
            this.send_({ k: 'res', id, e: errorText(err) });
        }
    }

    private resolvePending_(msg: Incoming): void {
        const p = this.pending.get(msg.id ?? 0);
        if (!p) return;
        this.pending.delete(msg.id ?? 0);
        if (p.timer) clearTimeout(p.timer);
        if (msg.e !== undefined) { p.reject(new NetRequestError(msg.e, remoteCode(msg.e))); return; }
        try { p.resolve(msg.payload(p.codec)); } catch (err) { p.reject(new NetRequestError(`the reply could not be read: ${errorText(err)}`, 'remote')); }
    }
}

function incomingFromJson(data: string): Incoming | null {
    let msg: Wire;
    try { msg = JSON.parse(data) as Wire; } catch { return null; }
    if (!msg || typeof (msg as { k?: unknown }).k !== 'string') return null;
    const any = msg as unknown as Record<string, unknown>;
    return {
        k: msg.k,
        t: typeof any.t === 'string' ? any.t : undefined,
        id: typeof any.id === 'number' ? any.id : undefined,
        ik: typeof any.ik === 'string' ? any.ik : undefined,
        e: typeof any.e === 'string' ? any.e : undefined,
        n: typeof any.n === 'number' ? any.n : undefined,
        hasPayload: 'd' in any,
        payload: (codec) => (codec && any.d !== undefined ? codec.fromJSON(any.d) : any.d),
    };
}

function incomingFromEnvelope(e: Envelope | null): Incoming | null {
    if (!e) return null;
    const bytes = e.payload;
    return {
        k: e.kind, t: e.type, id: e.id, ik: e.key, e: e.error, n: e.id,
        hasPayload: bytes !== undefined,
        payload: (codec) => {
            if (bytes === undefined) return undefined;
            return codec ? codec.decode(bytes) : JSON.parse(utf8Back.decode(bytes));
        },
    };
}

function remoteCode(message: string): NetRequestErrorCode {
    if (message === NET_RATE_LIMITED) return 'rate-limited';
    if (message === NET_ATTEMPT_FAILED) return 'retry';
    return 'remote';
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
