// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MessagePortTransport.ts
 * @brief   NetTransport over a MessagePort — replication between same-machine
 *          realms (editor multiplayer preview across play iframes, web
 *          workers) with no socket. Structured clone carries both wire planes
 *          (JSON strings and ArrayBuffer frames) natively, and a port queues
 *          messages until the other end attaches, so wiring order is free.
 *
 * @beta   Pre-1.0 networking: client prediction will reshape this surface.
 */
import type { NetTransport } from './NetChannel';

/** The minimal MessagePort surface (structural — works for window and worker
 *  ports). A real DOM MessagePort types its `onmessage` against the full
 *  MessageEvent, which mutable-property variance rejects against this shape,
 *  so the constructor also accepts MessagePort directly. */
export interface MessagePortLike {
    postMessage(data: unknown): void;
    onmessage: ((event: { data: unknown }) => void) | null;
    close?(): void;
}

export class MessagePortTransport implements NetTransport {
    onMessage: ((data: string | ArrayBuffer) => void) | null = null;

    private readonly port_: MessagePortLike;

    constructor(port: MessagePortLike | MessagePort) {
        this.port_ = port as MessagePortLike;
        // Assigning onmessage implicitly starts a DOM MessagePort.
        this.port_.onmessage = (e) => {
            const d = e.data;
            if (typeof d === 'string' || d instanceof ArrayBuffer) {
                this.onMessage?.(d);
            }
        };
    }

    send(data: string | ArrayBuffer): void {
        this.port_.postMessage(data);
    }

    close(): void {
        this.port_.close?.();
    }
}
