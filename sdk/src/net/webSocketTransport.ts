// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    webSocketTransport.ts
 * @brief   A server-side WebSocket (the `ws` package's) as the transport
 *          replication runs over. Written against the surface of `ws` rather
 *          than importing it: the game's server owns its `ws` install,
 *          listener, TLS and proxy settings.
 *
 *          What it adds over a hand-written adapter is {@link NetTransport.batch}:
 *          a replication sample sends a client several frames (spawns, the
 *          delta, the input ack), and one socket write each is what a server
 *          spends most of its time on — measured at 47% of a 300-player
 *          authority's CPU. Batched, they leave in one write.
 */
import type { ReliableOrderedTransport } from './NetChannel';

/** The part of a `ws` WebSocket this adapter uses. */
export interface ServerWebSocketLike {
    on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): unknown;
    send(data: string | ArrayBufferLike | ArrayBufferView): void;
}

/** What `ws` keeps under its socket: the Node stream, which can hold writes. */
interface CorkableStream {
    cork(): void;
    uncork(): void;
}

function streamOf(socket: ServerWebSocketLike): CorkableStream | null {
    // `ws` has no public way to hold writes; its underlying `net.Socket` does.
    const stream = (socket as { _socket?: unknown })._socket as Partial<CorkableStream> | null | undefined;
    return stream && typeof stream.cork === 'function' && typeof stream.uncork === 'function'
        ? stream as CorkableStream
        : null;
}

/**
 * Wrap one accepted server-side WebSocket for `ReplicationServer.attachConnection`.
 * A WebSocket loses and reorders nothing, so the reliable-ordered claim is honest.
 */
export function webSocketTransport(socket: ServerWebSocketLike): ReliableOrderedTransport {
    const handlers = new Set<(data: string | ArrayBuffer) => void>();
    socket.on('message', (data, isBinary) => {
        // Binary frames are the delta stream and must reach the channel as an
        // ArrayBuffer of exactly their bytes.
        const frame = isBinary ? frameToArrayBuffer(data) : String(data);
        for (const handler of [...handlers]) handler(frame);
    });
    return {
        delivery: 'reliable-ordered',
        send: (data) => socket.send(data),
        on: (_event, handler) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        batch: () => {
            const stream = streamOf(socket);
            if (!stream) return noop;
            stream.cork();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                stream.uncork();
            };
        },
    };
}

const noop = (): void => {};

/**
 * A `ws` message as an ArrayBuffer of exactly its bytes. `ws` hands over a
 * Buffer that is usually a VIEW into a larger pooled allocation, or an array
 * of fragments, never the bytes alone.
 */
export function frameToArrayBuffer(data: unknown): ArrayBuffer {
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) {
        const copy = new Uint8Array(data.byteLength);
        copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        return copy.buffer;
    }
    if (Array.isArray(data)) {
        const total = data.reduce((n: number, part: ArrayBufferView) => n + part.byteLength, 0);
        const out = new Uint8Array(total);
        let at = 0;
        for (const part of data as ArrayBufferView[]) {
            out.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), at);
            at += part.byteLength;
        }
        return out.buffer;
    }
    return new ArrayBuffer(0);
}
