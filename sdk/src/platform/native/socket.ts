// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  socket.ts — a platform socket over the native host's `ws://` client.
 */
import { Emitter } from '../../ecs/emitter';
import type { PlatformSocket, PlatformSocketEvents, PlatformSocketReadyState } from '../types';
import type { NativeSocketBridge } from './bridge';

export class NativeSocket implements PlatformSocket {
    readonly delivery = 'reliable-ordered' as const;
    readyState: PlatformSocketReadyState = 'closed';
    private readonly events_ = new Emitter<PlatformSocketEvents>();
    private handle_: { send(data: string | ArrayBuffer): boolean; close(code?: number, reason?: string): void } | null = null;
    private queue_: (string | ArrayBuffer)[] = [];

    constructor(private readonly url_: string, private readonly bridge_: NativeSocketBridge) {}

    on<K extends keyof PlatformSocketEvents>(event: K, handler: (...args: PlatformSocketEvents[K]) => void): () => void {
        return this.events_.on(event, handler);
    }

    connect(): void {
        if (this.handle_) return;
        this.readyState = 'connecting';
        this.handle_ = this.bridge_.open(this.url_, (e) => {
            if (e.type === 'open') {
                this.readyState = 'open';
                for (const m of this.queue_) this.handle_?.send(m);
                this.queue_ = [];
                this.events_.emit('open');
            } else if (e.type === 'message') {
                this.events_.emit('message', e.data ?? '');
            } else if (e.type === 'error') {
                this.events_.emit('error', new Error(e.reason ?? 'socket error'));
            } else {
                this.readyState = 'closed';
                this.handle_ = null;
                this.events_.emit('close', e.code ?? 1006, e.reason ?? '');
            }
        });
    }

    send(data: string | ArrayBuffer): void {
        if (this.readyState === 'open' && this.handle_) this.handle_.send(data);
        else this.queue_.push(data);
    }

    close(code?: number, reason?: string): void {
        if (!this.handle_) return;
        this.readyState = 'closing';
        this.handle_.close(code, reason);
    }
}
