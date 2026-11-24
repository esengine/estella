// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    remote.ts
 * @brief   One store, shared by every server process. `StoreHub` puts any
 *          {@link PersistStore} behind WebSockets; each process talks to it
 *          through a `RemoteStore`, which is a PersistStore itself — so
 *          records, leases, tickets and transactions work across processes
 *          exactly as they do in one, because every versioned write and every
 *          transaction runs where the store is.
 *
 *          The hub is meant for a private network: it checks a shared secret
 *          at the hello and nothing finer. A store reachable from the
 *          internet wants a database with its own access control instead.
 */
import type { PlatformSocket } from '../platform/types';
import { PersistConflict, type PersistOp, type PersistStore, type PersistWriteOptions, type StoredDocument } from './store';

type StoreRequest =
    | { id: number; op: 'hello'; secret?: string }
    | { id: number; op: 'get'; key: string }
    | { id: number; op: 'put'; key: string; value: unknown; options?: PersistWriteOptions }
    | { id: number; op: 'delete'; key: string; options?: PersistWriteOptions }
    | { id: number; op: 'keys'; prefix?: string }
    | { id: number; op: 'transact'; ops: PersistOp[] };

interface StoreError {
    name: string;
    message: string;
    key?: string;
    expected?: number;
    actual?: number;
}

type StoreResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: StoreError };

/** The part of a `ws` WebSocket the hub uses. */
export interface StoreHubSocket {
    on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
    on(event: 'close', listener: () => void): unknown;
    on(event: 'error', listener: (err: unknown) => void): unknown;
    send(data: string): void;
    close(code?: number, reason?: string): void;
}

export interface StoreHubOptions {
    /** A client must say hello with this before anything else is answered. Default: no secret. */
    secret?: string;
    /** Larger requests close the connection. Default 4 MiB. */
    maxFrameBytes?: number;
}

/**
 * Serve a store to other processes. Hand each accepted server socket to
 * `accept`; the listener, TLS and port stay the host's.
 */
export class StoreHub {
    private readonly store_: PersistStore;
    private readonly options_: StoreHubOptions;
    private connections_ = 0;

    constructor(store: PersistStore, options: StoreHubOptions = {}) {
        this.store_ = store;
        this.options_ = options;
    }

    get connectionCount(): number {
        return this.connections_;
    }

    accept(socket: StoreHubSocket): void {
        this.connections_++;
        let open = true;
        let admitted = this.options_.secret === undefined;
        const maxFrame = this.options_.maxFrameBytes ?? 4 * 1024 * 1024;
        const drop = (): void => {
            if (open) {
                open = false;
                this.connections_--;
            }
        };
        socket.on('close', drop);
        socket.on('error', drop);
        const reply = (res: StoreResponse): void => {
            if (!open) return;
            try { socket.send(JSON.stringify(res)); } catch { /* gone; its close follows */ }
        };
        socket.on('message', (raw, isBinary) => {
            if (!open || isBinary) return;
            const text = String(raw);
            if (text.length > maxFrame) { socket.close(1009, 'request too large'); drop(); return; }
            let req: StoreRequest;
            try { req = JSON.parse(text) as StoreRequest; } catch { return; }
            if (typeof req?.id !== 'number') return;
            if (req.op === 'hello') {
                admitted = this.options_.secret === undefined || req.secret === this.options_.secret;
                if (!admitted) {
                    reply({ id: req.id, ok: false, error: { name: 'StoreRefused', message: 'wrong secret' } });
                    socket.close(1008, 'wrong secret');
                    drop();
                    return;
                }
                reply({ id: req.id, ok: true, result: true });
                return;
            }
            if (!admitted) { socket.close(1008, 'hello first'); drop(); return; }
            void this.run_(req).then(
                (result) => reply({ id: req.id, ok: true, result: result ?? null }),
                (err: unknown) => {
                    const e = err as Partial<PersistConflict> & { name?: string; message?: string };
                    reply({ id: req.id, ok: false, error: { name: e?.name ?? 'Error', message: e?.message ?? String(err), key: e?.key, expected: e?.expected, actual: e?.actual } });
                },
            );
        });
    }

    private run_(req: StoreRequest): Promise<unknown> {
        const s = this.store_;
        switch (req.op) {
            case 'get': return s.get(req.key);
            case 'put': return s.put(req.key, req.value, req.options);
            case 'delete': return s.delete(req.key, req.options);
            case 'keys': return s.keys(req.prefix);
            case 'transact':
                if (!s.transact) return Promise.reject(new Error('[persist] the hub\'s store has no transactions'));
                return s.transact(req.ops);
            default: return Promise.reject(new Error('[persist] unknown store request'));
        }
    }
}

export interface RemoteStoreOptions {
    /** A fresh, unopened socket to the hub, each call: `() => createSocket({ url })`. */
    connect: () => PlatformSocket;
    /** The hub's secret, when it has one. */
    secret?: string;
    /** A call not answered by now fails (whether or not the hub ran it). Default 10 s. */
    timeoutMs?: number;
    /** Wait before redialing a lost hub: starts here, doubles to `maxDelayMs`. Default 200 ms / 5 s. */
    minDelayMs?: number;
    maxDelayMs?: number;
}

/** Why the hub would not answer: a wrong secret, or no hub to ask. */
export class StoreUnavailable extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StoreUnavailable';
    }
}

interface Pending {
    req: StoreRequest;
    resolve(v: unknown): void;
    reject(e: Error): void;
    timer: ReturnType<typeof setTimeout>;
    sent: boolean;
}

/**
 * A process's side of a StoreHub: a PersistStore whose every call is a round
 * trip. Calls made while the hub is out of reach wait for it (up to
 * `timeoutMs`); a call sent before a drop and not answered is not sent again —
 * it fails, since the hub may have run it, and the caller's versioned write
 * tells on a retry whether it did.
 */
export class RemoteStore implements PersistStore {
    private readonly options_: RemoteStoreOptions;
    private readonly pending_ = new Map<number, Pending>();
    private socket_: PlatformSocket | null = null;
    private ready_ = false;
    private closed_ = false;
    private refused_: string | null = null;
    private nextId_ = 1;
    private delay_ = 0;
    private timer_: ReturnType<typeof setTimeout> | null = null;

    constructor(options: RemoteStoreOptions) {
        this.options_ = options;
        this.dial_();
    }

    /** Whether the hub is reachable and has let this client in. */
    get connected(): boolean {
        return this.ready_;
    }

    get<T = unknown>(key: string): Promise<StoredDocument<T> | null> {
        return this.call_({ id: 0, op: 'get', key }) as Promise<StoredDocument<T> | null>;
    }

    put<T = unknown>(key: string, value: T, options?: PersistWriteOptions): Promise<number> {
        return this.call_({ id: 0, op: 'put', key, value, ...(options ? { options } : {}) }) as Promise<number>;
    }

    delete(key: string, options?: PersistWriteOptions): Promise<boolean> {
        return this.call_({ id: 0, op: 'delete', key, ...(options ? { options } : {}) }) as Promise<boolean>;
    }

    keys(prefix?: string): Promise<string[]> {
        return this.call_({ id: 0, op: 'keys', ...(prefix !== undefined ? { prefix } : {}) }) as Promise<string[]>;
    }

    transact(ops: readonly PersistOp[]): Promise<number[]> {
        return this.call_({ id: 0, op: 'transact', ops: [...ops] }) as Promise<number[]>;
    }

    /** Stop for good: calls still waiting fail. */
    close(): void {
        this.closed_ = true;
        if (this.timer_) clearTimeout(this.timer_);
        this.socket_?.close(1000, 'store closed');
        this.socket_ = null;
        this.ready_ = false;
        for (const p of [...this.pending_.values()]) this.fail_(p, new StoreUnavailable('store closed'));
    }

    private call_(req: StoreRequest): Promise<unknown> {
        if (this.closed_) return Promise.reject(new StoreUnavailable('store closed'));
        if (this.refused_) return Promise.reject(new StoreUnavailable(this.refused_));
        return new Promise((resolve, reject) => {
            const id = this.nextId_++;
            const p: Pending = {
                req: { ...req, id }, resolve, reject, sent: false,
                timer: setTimeout(() => this.fail_(p, new StoreUnavailable(`store call "${req.op}" timed out`)), this.options_.timeoutMs ?? 10_000),
            };
            this.pending_.set(id, p);
            if (this.ready_) this.send_(p);
        });
    }

    private send_(p: Pending): void {
        p.sent = true;
        try { this.socket_?.send(JSON.stringify(p.req)); } catch { /* the close fails it */ }
    }

    private fail_(p: Pending, err: Error): void {
        if (!this.pending_.delete(p.req.id)) return;
        clearTimeout(p.timer);
        p.reject(err);
    }

    private dial_(): void {
        if (this.closed_) return;
        const socket = this.options_.connect();
        this.socket_ = socket;
        let helloId = 0;
        socket.on('open', () => {
            if (this.socket_ !== socket) return;
            helloId = this.nextId_++;
            socket.send(JSON.stringify({ id: helloId, op: 'hello', ...(this.options_.secret !== undefined ? { secret: this.options_.secret } : {}) }));
        });
        socket.on('message', (raw: unknown) => {
            if (this.socket_ !== socket || typeof raw !== 'string') return;
            let res: StoreResponse;
            try { res = JSON.parse(raw) as StoreResponse; } catch { return; }
            if (res.id === helloId) {
                if (!res.ok) {
                    this.refused_ = res.error.message;
                    for (const p of [...this.pending_.values()]) this.fail_(p, new StoreUnavailable(res.error.message));
                    return;
                }
                this.ready_ = true;
                this.delay_ = 0;
                // What waited for the hub goes now.
                for (const p of this.pending_.values()) if (!p.sent) this.send_(p);
                return;
            }
            const p = this.pending_.get(res.id);
            if (!p) return;
            this.pending_.delete(res.id);
            clearTimeout(p.timer);
            if (res.ok) p.resolve(res.result);
            else if (res.error.name === 'PersistConflict') p.reject(new PersistConflict(res.error.key ?? '', res.error.expected ?? 0, res.error.actual ?? 0));
            else p.reject(Object.assign(new Error(res.error.message), { name: res.error.name }));
        });
        socket.on('close', () => {
            if (this.socket_ !== socket) return;
            this.ready_ = false;
            this.socket_ = null;
            // Sent and not answered: the hub may have run it, so it is not sent twice.
            for (const p of [...this.pending_.values()]) if (p.sent) this.fail_(p, new StoreUnavailable(`lost the store during "${p.req.op}"`));
            if (this.closed_ || this.refused_) return;
            const min = this.options_.minDelayMs ?? 200;
            this.delay_ = this.delay_ === 0 ? min : Math.min(this.options_.maxDelayMs ?? 5000, this.delay_ * 2);
            this.timer_ = setTimeout(() => { this.timer_ = null; this.dial_(); }, this.delay_);
        });
        socket.connect();
    }
}
