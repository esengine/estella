// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WeChatSocket.ts
 * @brief   Raw wx.connectSocket wrapper behind the platform socket seam.
 */
import { Emitter } from '../emitter';
import type { PlatformSocket, PlatformSocketEvents } from '../platform/types';
import type { GameSocketOptions, SocketReadyState } from './GameSocket';

export class WeChatSocket implements PlatformSocket {
    private url_: string;
    private protocols_?: string | string[];
    private task_: any = null;
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
        if (this.task_) return;

        const wx = (globalThis as any).wx;
        if (!wx?.connectSocket) {
            this.events_.emit('error', 'wx.connectSocket not available');
            return;
        }

        this.readyState = 'connecting';

        this.task_ = wx.connectSocket({
            url: this.url_,
            protocols: Array.isArray(this.protocols_) ? this.protocols_ : this.protocols_ ? [this.protocols_] : undefined,
        });

        this.task_.onOpen(() => {
            this.readyState = 'open';
            for (const msg of this.sendQueue_) {
                this.task_.send({ data: msg });
            }
            this.sendQueue_ = [];
            this.events_.emit('open');
        });

        this.task_.onMessage((res: { data: string | ArrayBuffer }) => {
            this.events_.emit('message', res.data);
        });

        this.task_.onClose((res: { code: number; reason: string }) => {
            this.readyState = 'closed';
            this.task_ = null;
            this.events_.emit('close', res.code, res.reason);
        });

        this.task_.onError((err: unknown) => {
            this.events_.emit('error', err);
        });
    }

    send(data: string | ArrayBuffer): void {
        if (this.readyState === 'open' && this.task_) {
            this.task_.send({ data });
        } else {
            this.sendQueue_.push(data);
        }
    }

    close(code?: number, reason?: string): void {
        if (this.task_) {
            this.readyState = 'closing';
            this.task_.close({ code, reason });
        }
    }
}
