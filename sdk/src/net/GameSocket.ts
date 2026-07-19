// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GameSocket.ts
 * @brief   Raw browser-WebSocket wrapper behind the platform socket seam.
 */
import { Emitter } from '../emitter';
import type {
    PlatformSocket,
    PlatformSocketEvents,
    PlatformSocketOptions,
    PlatformSocketReadyState,
} from '../platform/types';

export type SocketReadyState = PlatformSocketReadyState;

export type GameSocketOptions = PlatformSocketOptions;

export class GameSocket implements PlatformSocket {
    private url_: string;
    private protocols_?: string | string[];
    private ws_: WebSocket | null = null;
    private sendQueue_: (string | ArrayBuffer)[] = [];
    private events_ = new Emitter<PlatformSocketEvents>();

    readyState: SocketReadyState = 'closed';

    constructor(options: GameSocketOptions) {
        this.url_ = options.url;
        this.protocols_ = options.protocols;
    }

    on<K extends keyof PlatformSocketEvents>(
        event: K,
        handler: (...args: PlatformSocketEvents[K]) => void,
    ): () => void {
        return this.events_.on(event, handler);
    }

    connect(): void {
        if (this.ws_) return;

        this.readyState = 'connecting';

        try {
            this.ws_ = new WebSocket(this.url_, this.protocols_);
            this.ws_.binaryType = 'arraybuffer';

            this.ws_.onopen = () => {
                this.readyState = 'open';
                for (const msg of this.sendQueue_) {
                    this.ws_!.send(msg);
                }
                this.sendQueue_ = [];
                this.events_.emit('open');
            };

            this.ws_.onmessage = (e) => {
                this.events_.emit('message', e.data);
            };

            this.ws_.onclose = (e) => {
                this.readyState = 'closed';
                this.ws_ = null;
                this.events_.emit('close', e.code, e.reason);
            };

            this.ws_.onerror = (e) => {
                this.events_.emit('error', e);
            };
        } catch (e) {
            this.readyState = 'closed';
            this.events_.emit('error', e);
        }
    }

    send(data: string | ArrayBuffer): void {
        if (this.readyState === 'open' && this.ws_) {
            this.ws_.send(data);
        } else {
            this.sendQueue_.push(data);
        }
    }

    close(code?: number, reason?: string): void {
        if (this.ws_) {
            this.readyState = 'closing';
            this.ws_.close(code, reason);
        }
    }
}
