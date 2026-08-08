// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    emitter.ts
 * @brief   Minimal typed multicast backing the `on(event, fn)` → unsubscribe
 *          surfaces (sockets, transports, ScreenInfo).
 */

type AnyHandler = (...args: unknown[]) => void;

let liveHandlers = 0;

/**
 * Handlers subscribed through every Emitter in this realm, right now.
 *
 * A forgotten unsubscribe is invisible per-instance — one extra handler looks
 * like nothing — and shows only as a total that never comes back down. The
 * census treats it as conserved: a Play/Stop round trip must end where it began.
 */
export function liveEmitterHandlers(): number {
    return liveHandlers;
}

export class Emitter<E extends Record<keyof E, unknown[]>> {
    private handlers_ = new Map<keyof E, Set<AnyHandler>>();

    on<K extends keyof E>(event: K, handler: (...args: E[K]) => void): () => void {
        let set = this.handlers_.get(event);
        if (!set) {
            set = new Set();
            this.handlers_.set(event, set);
        }
        if (!set.has(handler as AnyHandler)) {
            set.add(handler as AnyHandler);
            liveHandlers++;
        }
        return () => {
            // Delete reports whether it removed anything, so an unsubscribe called
            // twice — or after clear() — cannot drive the live count negative.
            if (set.delete(handler as AnyHandler)) {
                liveHandlers--;
                if (set.size === 0) this.handlers_.delete(event);
            }
        };
    }

    emit<K extends keyof E>(event: K, ...args: E[K]): void {
        const set = this.handlers_.get(event);
        if (!set) return;
        // Copy: a handler may (un)subscribe during dispatch.
        for (const h of [...set]) h(...args);
    }

    clear(): void {
        for (const set of this.handlers_.values()) liveHandlers -= set.size;
        this.handlers_.clear();
    }

    /** Handlers held by this emitter across all its events. */
    get size(): number {
        let n = 0;
        for (const set of this.handlers_.values()) n += set.size;
        return n;
    }
}
