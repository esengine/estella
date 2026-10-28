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

export interface AbortHandle {
    readonly signal: AbortSignal;
    abort(reason?: unknown): void;
}

class FallbackSignal {
    aborted = false;
    reason: unknown = undefined;
    onabort: ((event: { type: 'abort' }) => void) | null = null;
    private listeners_: Array<(event: { type: 'abort' }) => void> = [];

    addEventListener(type: string, listener: (event: { type: 'abort' }) => void): void {
        if (type === 'abort') this.listeners_.push(listener);
    }

    removeEventListener(type: string, listener: (event: { type: 'abort' }) => void): void {
        if (type !== 'abort') return;
        const i = this.listeners_.indexOf(listener);
        if (i >= 0) this.listeners_.splice(i, 1);
    }

    throwIfAborted(): void {
        if (this.aborted) throw this.reason;
    }

    fire(reason: unknown): void {
        if (this.aborted) return;
        this.aborted = true;
        this.reason = reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
        const event = { type: 'abort' as const };
        this.onabort?.(event);
        for (const listener of this.listeners_.slice()) listener(event);
    }
}

export function createAbort(): AbortHandle {
    if (typeof AbortController !== 'undefined') return new AbortController();
    const signal = new FallbackSignal();
    return { signal: signal as unknown as AbortSignal, abort: (reason) => signal.fire(reason) };
}
