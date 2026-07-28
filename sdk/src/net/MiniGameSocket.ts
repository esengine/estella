// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MiniGameSocket.ts
 * @brief   The mini-game family's WebSocket transport, behind the platform
 *          socket seam.
 *
 *          Mini-game hosts have no `WebSocket` constructor; they hand out a task
 *          object from `connectSocket()`. This wraps that task against the
 *          normalized {@link MiniGameSocketTask} — so it is the socket for every
 *          vendor of the family, not for one of them.
 */
import { Emitter } from '../ecs/emitter';
import type { PlatformSocket, PlatformSocketEvents } from '../platform/types';
import type { MiniGameGlobal, MiniGameSocketTask } from '../platform/minigame/api';
import type { GameSocketOptions, SocketReadyState } from './GameSocket';

export class MiniGameSocket implements PlatformSocket {
    private url_: string;
    private protocols_?: string | string[];
    private readonly g_: MiniGameGlobal;
    private task_: MiniGameSocketTask | null = null;
    private sendQueue_: (string | ArrayBuffer)[] = [];
    private events_ = new Emitter<PlatformSocketEvents>();

    readyState: SocketReadyState = 'closed';

    constructor(options: GameSocketOptions, global: MiniGameGlobal) {
        this.url_ = options.url;
        this.protocols_ = options.protocols;
        this.g_ = global;
    }

    on<K extends keyof PlatformSocketEvents>(
        event: K,
        handler: (...args: PlatformSocketEvents[K]) => void,
    ): () => void {
        return this.events_.on(event, handler);
    }

    connect(): void {
        if (this.task_) return;

        if (typeof this.g_.connectSocket !== 'function') {
            this.events_.emit('error', 'connectSocket is not available on this mini-game host');
            return;
        }

        this.readyState = 'connecting';

        const task = this.g_.connectSocket({
            url: this.url_,
            protocols: Array.isArray(this.protocols_) ? this.protocols_ : this.protocols_ ? [this.protocols_] : undefined,
        });
        this.task_ = task;

        task.onOpen(() => {
            this.readyState = 'open';
            for (const msg of this.sendQueue_) {
                task.send({ data: msg });
            }
            this.sendQueue_ = [];
            this.events_.emit('open');
        });

        task.onMessage((res: { data: string | ArrayBuffer }) => {
            this.events_.emit('message', res.data);
        });

        task.onClose((res: { code: number; reason: string }) => {
            this.readyState = 'closed';
            this.task_ = null;
            this.events_.emit('close', res.code, res.reason);
        });

        task.onError((err: unknown) => {
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
