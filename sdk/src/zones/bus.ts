// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bus.ts
 * @brief   Messages between server processes. A zone publishes to a topic and
 *          every process subscribed to it hears — a zone's own topic for what
 *          is meant for one of its players, a shared one for what every zone
 *          needs. Delivery is at most once and in order per publisher, as on a
 *          Redis channel: a process not listening at that moment does not hear,
 *          and nothing is stored. What has to arrive however long it takes (mail,
 *          a trade's result) goes in the store; the bus says "look now".
 *
 *          `MemoryBus` is for one process; `BusHub` relays between processes
 *          over WebSockets and `RemoteBus` is its client. A Redis or NATS
 *          adapter is the two methods of {@link ZoneBus}.
 */
import type { PlatformSocket } from '../platform/types';

/** Publish and subscribe, by topic. Messages are JSON. */
export interface ZoneBus {
    /** Send to everyone subscribed to `topic` now. Fire and forget. */
    publish(topic: string, message: unknown): void;
    /** Hear `topic`. Returns an unsubscribe. */
    subscribe(topic: string, handler: (message: unknown) => void): () => void;
}

/**
 * A bus within one process: zones run side by side in one server, or tests.
 * Delivers on a later microtask, as a copy, so a handler never runs inside the
 * publisher's call or holds the publisher's object.
 */
export class MemoryBus implements ZoneBus {
    private readonly topics_ = new Map<string, Set<(message: unknown) => void>>();

    publish(topic: string, message: unknown): void {
        const handlers = this.topics_.get(topic);
        if (!handlers || handlers.size === 0) return;
        const json = JSON.stringify(message);
        const list = [...handlers];
        queueMicrotask(() => {
            for (const h of list) {
                try { h(json === undefined ? undefined : JSON.parse(json)); } catch { /* one handler does not stop the rest */ }
            }
        });
    }

    subscribe(topic: string, handler: (message: unknown) => void): () => void {
        let set = this.topics_.get(topic);
        if (!set) { set = new Set(); this.topics_.set(topic, set); }
        set.add(handler);
        return () => {
            set!.delete(handler);
            if (set!.size === 0) this.topics_.delete(topic);
        };
    }
}

// ---------------------------------------------------------------------------
// Over a WebSocket: the hub and its clients
// ---------------------------------------------------------------------------

/** What travels between a RemoteBus and its hub. */
type BusFrame =
    | { op: 'sub'; topic: string }
    | { op: 'unsub'; topic: string }
    | { op: 'pub'; topic: string; data: unknown }
    | { op: 'msg'; topic: string; data: unknown };

/** The part of a `ws` WebSocket the hub uses (as `acceptWebSocket` takes it). */
export interface BusHubSocket {
    on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
    on(event: 'close', listener: () => void): unknown;
    on(event: 'error', listener: (err: unknown) => void): unknown;
    send(data: string): void;
    close(code?: number, reason?: string): void;
}

export interface BusHubOptions {
    /** Larger frames close the connection. Default 1 MiB. */
    maxFrameBytes?: number;
    /** Topics one connection may hold. Default 10 000. */
    maxTopicsPerConnection?: number;
}

/**
 * The relay: every process connects a RemoteBus to it, and a publish reaches
 * every connection subscribed to the topic (the publisher too, if it is).
 * Hand each accepted server socket to `accept`; the hub owns no listener, TLS
 * or port, which stay the host's.
 */
export class BusHub {
    private readonly topics_ = new Map<string, Set<BusHubSocket>>();
    private readonly maxFrame_: number;
    private readonly maxTopics_: number;
    private connections_ = 0;

    constructor(options: BusHubOptions = {}) {
        this.maxFrame_ = options.maxFrameBytes ?? 1024 * 1024;
        this.maxTopics_ = options.maxTopicsPerConnection ?? 10_000;
    }

    get connectionCount(): number {
        return this.connections_;
    }

    accept(socket: BusHubSocket): void {
        this.connections_++;
        const mine = new Set<string>();
        let open = true;
        const drop = (): void => {
            if (!open) return;
            open = false;
            this.connections_--;
            for (const topic of mine) this.leave_(topic, socket);
            mine.clear();
        };
        socket.on('close', drop);
        socket.on('error', drop);
        socket.on('message', (raw, isBinary) => {
            if (!open || isBinary) return;
            const text = String(raw);
            if (text.length > this.maxFrame_) { socket.close(1009, 'frame too large'); drop(); return; }
            let frame: BusFrame;
            try { frame = JSON.parse(text) as BusFrame; } catch { return; }
            if (typeof frame?.topic !== 'string') return;
            if (frame.op === 'sub') {
                if (mine.size >= this.maxTopics_) return;
                mine.add(frame.topic);
                let set = this.topics_.get(frame.topic);
                if (!set) { set = new Set(); this.topics_.set(frame.topic, set); }
                set.add(socket);
            } else if (frame.op === 'unsub') {
                mine.delete(frame.topic);
                this.leave_(frame.topic, socket);
            } else if (frame.op === 'pub') {
                const subs = this.topics_.get(frame.topic);
                if (!subs) return;
                const out = JSON.stringify({ op: 'msg', topic: frame.topic, data: frame.data });
                for (const s of subs) {
                    try { s.send(out); } catch { /* a dead subscriber is dropped by its own close */ }
                }
            }
        });
    }

    private leave_(topic: string, socket: BusHubSocket): void {
        const set = this.topics_.get(topic);
        if (!set) return;
        set.delete(socket);
        if (set.size === 0) this.topics_.delete(topic);
    }
}

export interface RemoteBusOptions {
    /** A fresh, unopened socket to the hub, each call: `() => createSocket({ url })`. */
    connect: () => PlatformSocket;
    /** Wait before redialing a lost hub: starts here, doubles to `maxDelayMs`. Default 200 ms / 5 s. */
    minDelayMs?: number;
    maxDelayMs?: number;
}

/**
 * A process's side of a BusHub. Redials a lost hub and subscribes again to
 * every topic it held; what was published while the link was down is lost,
 * as at-most-once means.
 */
export class RemoteBus implements ZoneBus {
    private readonly options_: RemoteBusOptions;
    private readonly topics_ = new Map<string, Set<(message: unknown) => void>>();
    private socket_: PlatformSocket | null = null;
    private open_ = false;
    private closed_ = false;
    private delay_ = 0;
    private timer_: ReturnType<typeof setTimeout> | null = null;

    constructor(options: RemoteBusOptions) {
        this.options_ = options;
        this.dial_();
    }

    /** Whether the hub is reachable right now. */
    get connected(): boolean {
        return this.open_;
    }

    publish(topic: string, message: unknown): void {
        if (!this.open_) return;
        this.send_({ op: 'pub', topic, data: message });
    }

    subscribe(topic: string, handler: (message: unknown) => void): () => void {
        let set = this.topics_.get(topic);
        if (!set) {
            set = new Set();
            this.topics_.set(topic, set);
            if (this.open_) this.send_({ op: 'sub', topic });
        }
        set.add(handler);
        return () => {
            set!.delete(handler);
            if (set!.size > 0) return;
            this.topics_.delete(topic);
            if (this.open_) this.send_({ op: 'unsub', topic });
        };
    }

    /** Stop for good: no redial, no more messages. */
    close(): void {
        this.closed_ = true;
        if (this.timer_) clearTimeout(this.timer_);
        this.socket_?.close(1000, 'bus closed');
        this.socket_ = null;
        this.open_ = false;
    }

    private send_(frame: BusFrame): void {
        try { this.socket_?.send(JSON.stringify(frame)); } catch { /* the close will redial */ }
    }

    private dial_(): void {
        if (this.closed_) return;
        const socket = this.options_.connect();
        this.socket_ = socket;
        socket.on('open', () => {
            if (this.socket_ !== socket) return;
            this.open_ = true;
            this.delay_ = 0;
            for (const topic of this.topics_.keys()) this.send_({ op: 'sub', topic });
        });
        socket.on('message', (raw: unknown) => {
            if (this.socket_ !== socket || typeof raw !== 'string') return;
            let frame: BusFrame;
            try { frame = JSON.parse(raw) as BusFrame; } catch { return; }
            if (frame.op !== 'msg') return;
            const handlers = this.topics_.get(frame.topic);
            if (!handlers) return;
            for (const h of [...handlers]) {
                try { h(frame.data); } catch { /* one handler does not stop the rest */ }
            }
        });
        socket.on('close', () => {
            if (this.socket_ !== socket) return;
            this.open_ = false;
            this.socket_ = null;
            if (this.closed_) return;
            const min = this.options_.minDelayMs ?? 200;
            this.delay_ = this.delay_ === 0 ? min : Math.min(this.options_.maxDelayMs ?? 5000, this.delay_ * 2);
            this.timer_ = setTimeout(() => { this.timer_ = null; this.dial_(); }, this.delay_);
        });
        socket.connect();
    }
}
