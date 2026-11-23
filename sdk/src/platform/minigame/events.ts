// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { MiniGameGlobal, MiniGameKeyEvent, MiniGameTouchEvent } from './api';

type Listener<T> = (event: T) => void;
type Hook<T> = (listener: Listener<T>) => void;

// The permanent host callback captures only the set. A game opened by one
// delivery starts with the next event, and a game closed by it is skipped.
function dispatcher<T>(listeners: Set<Listener<T>>): Listener<T> {
    return event => {
        for (const listener of [...listeners]) {
            if (listeners.has(listener)) listener(event);
        }
    };
}

/** Older hosts expose some onX hooks without offX. Install one dispatcher on
 * such a host and let each App remove its own subscription from that dispatcher. */
function hostEvent<T>(
    on: (host: MiniGameGlobal) => Hook<T> | undefined,
    off: (host: MiniGameGlobal) => Hook<T> | undefined,
) {
    const shared = new WeakMap<MiniGameGlobal, Set<Listener<T>>>();
    return (host: MiniGameGlobal, listener: Listener<T>): (() => void) => {
        const subscribe = on(host);
        if (!subscribe) return () => {};
        const unsubscribe = off(host);
        if (unsubscribe) {
            let active = true;
            const receive: Listener<T> = event => { if (active) listener(event); };
            subscribe.call(host, receive);
            return () => {
                if (!active) return;
                active = false;
                unsubscribe.call(host, receive);
            };
        }
        const receive: Listener<T> = event => listener(event);
        const existing = shared.get(host);
        if (existing) {
            existing.add(receive);
            return () => { existing.delete(receive); };
        }
        const listeners = new Set([receive]);
        shared.set(host, listeners);
        try {
            subscribe.call(host, dispatcher(listeners));
        } catch (error) {
            listeners.clear();
            shared.delete(host);
            throw error;
        }
        return () => { listeners.delete(receive); };
    };
}

export const miniGameEvents = {
    keyDown: hostEvent<MiniGameKeyEvent>(g => g.onKeyDown, g => g.offKeyDown),
    keyUp: hostEvent<MiniGameKeyEvent>(g => g.onKeyUp, g => g.offKeyUp),
    touchCancel: hostEvent<MiniGameTouchEvent>(g => g.onTouchCancel, g => g.offTouchCancel),
    show: hostEvent<void>(g => g.onShow, g => g.offShow),
    hide: hostEvent<void>(g => g.onHide, g => g.offHide),
};
