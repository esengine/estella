// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MemoryTransport.ts
 * @brief   An in-process transport pair — two NetTransports wired to each
 *          other with no socket. This is the replication test seam: a server
 *          App and a client App connect through a pair inside one process and
 *          step deterministically. `manualFlush` holds frames until the test
 *          pumps them, which is how delivery order, latency and packet
 *          interleaving are simulated.
 *
 * @beta   Pre-1.0 networking: client prediction will reshape this surface.
 */
import type { NetTransport } from './NetChannel';

export interface MemoryTransportOptions {
    /** Queue outgoing frames until flush() instead of delivering synchronously. */
    manualFlush?: boolean;
}

export class MemoryTransport implements NetTransport {
    onMessage: ((data: string | ArrayBuffer) => void) | null = null;

    private peer_: MemoryTransport | null = null;
    private readonly manualFlush_: boolean;
    private outbox_: (string | ArrayBuffer)[] = [];

    constructor(options: MemoryTransportOptions = {}) {
        this.manualFlush_ = options.manualFlush ?? false;
    }

    /** Frames sent but not yet delivered (manualFlush mode). */
    get pendingCount(): number {
        return this.outbox_.length;
    }

    send(data: string | ArrayBuffer): void {
        if (!this.peer_) return;
        if (this.manualFlush_) {
            this.outbox_.push(data);
        } else {
            this.peer_.onMessage?.(data);
        }
    }

    /** Deliver up to `limit` queued frames to the peer, in send order. */
    flush(limit = Infinity): void {
        if (!this.peer_) return;
        let n = 0;
        while (this.outbox_.length > 0 && n < limit) {
            const frame = this.outbox_.shift()!;
            this.peer_.onMessage?.(frame);
            n++;
        }
    }

    /** Drop queued frames without delivering (packet loss simulation). */
    dropPending(): void {
        this.outbox_ = [];
    }

    static pair(options: MemoryTransportOptions = {}): [MemoryTransport, MemoryTransport] {
        const a = new MemoryTransport(options);
        const b = new MemoryTransport(options);
        a.peer_ = b;
        b.peer_ = a;
        return [a, b];
    }
}

export function createMemoryTransportPair(
    options: MemoryTransportOptions = {},
): [MemoryTransport, MemoryTransport] {
    return MemoryTransport.pair(options);
}
