// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    abort.ts
 * @brief   An abort handle that does not assume a browser.
 *
 * @details `AbortController` is a web platform API, not a JavaScript one, and QuickJS
 *          (the engine's native host) does not have it: a system that built one threw
 *          on every tick there. The platform's is used where it exists; elsewhere this
 *          one does the part a maker of chunks reads: `aborted`, `reason`, `onabort`
 *          and listeners, and `throwIfAborted`.
 */
import { log } from './logger';

export interface AbortHandle {
    readonly signal: AbortSignal;
    abort(reason?: unknown): void;
}

type AbortEvent = { type: 'abort' };
type AbortListener = ((event: AbortEvent) => void) | { handleEvent(event: AbortEvent): void };

class FallbackSignal {
    aborted = false;
    reason: unknown = undefined;
    onabort: ((event: AbortEvent) => void) | null = null;
    private listeners_ = new Set<AbortListener>();

    addEventListener(type: string, listener: AbortListener | null): void {
        if (type === 'abort' && listener && !this.aborted) this.listeners_.add(listener);
    }

    removeEventListener(type: string, listener: AbortListener | null): void {
        if (type === 'abort' && listener) this.listeners_.delete(listener);
    }

    throwIfAborted(): void {
        if (this.aborted) throw this.reason;
    }

    fire(reason: unknown): void {
        if (this.aborted) return;
        this.aborted = true;
        this.reason = reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
        const event = { type: 'abort' as const };
        const notify = (listener: AbortListener): void => {
            try {
                if (typeof listener === 'function') listener.call(this, event);
                else listener.handleEvent(event);
            } catch (error) { log.warn('abort', 'Abort listener failed', error); }
        };
        if (this.onabort) notify(this.onabort);
        for (const listener of this.listeners_) notify(listener);
        this.listeners_.clear();
    }
}

export function createAbort(): AbortHandle {
    if (typeof AbortController !== 'undefined') return new AbortController();
    const signal = new FallbackSignal();
    return { signal: signal as unknown as AbortSignal, abort: (reason) => signal.fire(reason) };
}
