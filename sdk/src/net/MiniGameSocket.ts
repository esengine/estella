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
    /** Ends the current task once: the host's close and close() race for it. */
    private end_: ((code: number, reason: string) => void) | null = null;
    private sendQueue_: (string | ArrayBuffer)[] = [];
    private events_ = new Emitter<PlatformSocketEvents>();

    /** `wx.connectSocket` and its siblings are WebSockets like any other. */
    readonly delivery = 'reliable-ordered' as const;
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
            if (this.task_ !== task) return; // let go of by close()
            this.readyState = 'open';
            for (const msg of this.sendQueue_) {
                task.send({ data: msg });
            }
            this.sendQueue_ = [];
            this.events_.emit('open');
        });

        task.onMessage((res: { data: string | ArrayBuffer }) => {
            if (this.task_ !== task) return;
            this.events_.emit('message', res.data);
        });

        let ended = false;
        const end = (code: number, reason: string): void => {
            if (ended) return;
            ended = true;
            this.readyState = 'closed';
            if (this.task_ === task) this.task_ = null;
            this.events_.emit('close', code, reason);
        };

        task.onClose((res: { code: number; reason: string }) => end(res.code, res.reason));
        this.end_ = end;

        task.onError((err: unknown) => {
            const failedToOpen = this.readyState === 'connecting';
            this.events_.emit('error', err);
            // A WeChat phone ends a refused dial with an error and no close, and a
            // caller that redials on close would wait for it forever.
            if (failedToOpen) end(1006, (err as { errMsg?: string } | null)?.errMsg ?? 'connect failed');
        });
    }

    send(data: string | ArrayBuffer): void {
        if (this.readyState === 'open' && this.task_) {
            this.task_.send({ data });
        } else {
            this.sendQueue_.push(data);
        }
    }

    /**
     * Close the link and let go of it now: the host's close still goes out, but
     * nothing waits for the peer to answer — one that stopped answering (a
     * half-open link) would hold `close` back. `close` is emitted here, once.
     */
    close(code?: number, reason?: string): void {
        const task = this.task_;
        if (!task) return;
        const end = this.end_;
        this.task_ = null;
        this.end_ = null;
        try { task.close({ code, reason }); } catch { /* already closing */ }
        end?.(code ?? 1000, reason ?? '');
    }
}
