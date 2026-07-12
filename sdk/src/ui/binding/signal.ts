// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/binding/signal.ts
 * @brief   Signal — a minimal reactive value, the source side of data binding.
 *
 * A signal holds a value and notifies subscribers when it changes; `bind` (see
 * `bind.ts`) drives a component field from one, replacing the imperative
 * get→mutate→insert loop that updating UI from game state used to require.
 * Push-based (subscribers run on `set`), so there is no per-frame polling.
 */

/** A read-only reactive value. */
export interface ReadonlySignal<T> {
    get(): T;
    /** Subscribe to changes; returns an unsubscribe. */
    subscribe(fn: (value: T) => void): () => void;
}

/** A writable reactive value. */
export interface Signal<T> extends ReadonlySignal<T> {
    set(value: T): void;
    update(fn: (prev: T) => T): void;
}

/** A reactive value seeded with `initial`. `set` notifies subscribers only when
 *  the value actually changes (`Object.is`), so an unchanged write is free. */
export function signal<T>(initial: T): Signal<T> {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    const set = (next: T): void => {
        if (Object.is(next, value)) return;
        value = next;
        for (const fn of [...subs]) fn(value); // snapshot: a subscriber may unsubscribe mid-notify
    };
    return {
        get: () => value,
        set,
        update: (fn) => set(fn(value)),
        subscribe: (fn) => {
            subs.add(fn);
            return () => subs.delete(fn);
        },
    };
}

/** A read-only signal computed from `sources`; recomputes (and notifies) whenever
 *  any source changes. Its subscriptions live for the process — use for
 *  app-lifetime derivations (e.g. `health / maxHealth`). */
export function derived<T>(sources: ReadonlySignal<unknown>[], compute: () => T): ReadonlySignal<T> {
    let value = compute();
    const subs = new Set<(v: T) => void>();
    const recompute = (): void => {
        const next = compute();
        if (Object.is(next, value)) return;
        value = next;
        for (const fn of [...subs]) fn(value);
    };
    for (const s of sources) s.subscribe(recompute);
    return {
        get: () => value,
        subscribe: (fn) => {
            subs.add(fn);
            return () => subs.delete(fn);
        },
    };
}
