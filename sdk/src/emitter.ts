// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    emitter.ts
 * @brief   Minimal typed multicast backing the `on(event, fn)` → unsubscribe
 *          surfaces (sockets, transports, ScreenInfo).
 */

type AnyHandler = (...args: unknown[]) => void;

export class Emitter<E extends Record<keyof E, unknown[]>> {
    private handlers_ = new Map<keyof E, Set<AnyHandler>>();

    on<K extends keyof E>(event: K, handler: (...args: E[K]) => void): () => void {
        let set = this.handlers_.get(event);
        if (!set) {
            set = new Set();
            this.handlers_.set(event, set);
        }
        set.add(handler as AnyHandler);
        return () => {
            set.delete(handler as AnyHandler);
        };
    }

    emit<K extends keyof E>(event: K, ...args: E[K]): void {
        const set = this.handlers_.get(event);
        if (!set) return;
        // Copy: a handler may (un)subscribe during dispatch.
        for (const h of [...set]) h(...args);
    }

    clear(): void {
        this.handlers_.clear();
    }
}
