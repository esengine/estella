// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The deadline path, tortured.
 *
 * A load that misses its deadline still finishes. Its caller already got a
 * rejection, so the value that arrives afterwards has no owner — for a texture
 * that is a GL handle nobody will ever free. AsyncCache disposes it, and the
 * whole question is whether it does so exactly once, and never for a value a
 * caller actually received.
 *
 * This is a property of its own rather than commands in the asset one, because
 * the deadline is a TIMER: real time would settle loads the scheduler was still
 * holding, so time here is fake and advanced by a command. Draining is done
 * with microtasks for the same reason — setTimeout is faked too.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { AsyncCache } from '../../src/asset/AsyncCache';
import { RuntimeConfig } from '../../src/defaults';
import { setLogLevel, LogLevel } from '../../src/util/logger';

const KEYS = ['a', 'b'] as const;
const TIMEOUT_MS = 1000;
const RUNS = Number(process.env.TORTURE_RUNS ?? 200);
const SEED = process.env.TORTURE_SEED ? Number(process.env.TORTURE_SEED) : undefined;

/** Let every queued microtask run. setTimeout is faked, so it cannot be used. */
async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

interface Value { id: number }

/** What the test can see about one run. */
interface Harness {
    cache: AsyncCache<Value>;
    /** Values the cache disposed as abandoned. */
    disposed: Value[];
    /** Values a caller actually received. */
    delivered: Value[];
    /** Values a loader produced. */
    produced: Value[];
}

/**
 * The invariants. Checked after every command, so a failure names the command
 * that caused it rather than the one that noticed.
 */
function check(h: Harness): void {
    // A value the cache disposed must never have been handed to a caller.
    for (const value of h.disposed) {
        if (h.delivered.includes(value)) {
            throw new Error(`value ${value.id} was delivered to a caller AND disposed as abandoned`);
        }
    }
    // Never twice.
    const seen = new Set<number>();
    for (const value of h.disposed) {
        if (seen.has(value.id)) throw new Error(`value ${value.id} was disposed twice`);
        seen.add(value.id);
    }
    // A disposed value must not be sitting in the cache waiting to be served.
    for (const key of KEYS) {
        const cached = h.cache.get(key);
        if (cached && h.disposed.includes(cached)) {
            throw new Error(`key ${key} is cached as value ${cached.id}, which was disposed`);
        }
    }
}

describe('AsyncCache deadline path under generated interleavings', () => {
    // Every expiry logs a warning by design; hundreds of generated runs would
    // bury any real signal in them. Restored to Info, the logger's own default —
    // it offers no way to read the level back.
    beforeEach(() => { vi.useFakeTimers(); setLogLevel(LogLevel.Error); });
    afterEach(() => { vi.useRealTimers(); setLogLevel(LogLevel.Info); });

    it('an abandoned value is disposed exactly once, and never a delivered one', async () => {
        const key = fc.constantFrom(...KEYS);
        const ACTIONS = ['request', 'settle', 'fail', 'invalidate', 'expire'] as const;

        await fc.assert(
            fc.asyncProperty(
                fc.array(fc.tuple(key, fc.constantFrom(...ACTIONS)), { minLength: 1, maxLength: 20 }),
                async (script) => {
                    const previous = RuntimeConfig.assetLoadTimeout;
                    RuntimeConfig.assetLoadTimeout = TIMEOUT_MS;
                    const gates = new Map<string, (v: Value) => void>();
                    const rejects = new Map<string, (e: Error) => void>();
                    const disposed: Value[] = [];
                    const delivered: Value[] = [];
                    const produced: Value[] = [];
                    let nextId = 1;
                    const cache = new AsyncCache<Value>((v) => { disposed.push(v); });
                    const h = { cache, disposed, delivered, produced } as unknown as Harness;
                    const inFlight: Promise<unknown>[] = [];

                    try {
                        for (const [k, action] of script) {
                            switch (action) {
                                case 'request':
                                    inFlight.push(cache.getOrLoad(k, () => new Promise<Value>((res, rej) => {
                                        gates.set(k, res);
                                        rejects.set(k, rej);
                                    })).then(
                                        (v) => { delivered.push(v); },
                                        () => {},
                                    ));
                                    break;
                                case 'settle': {
                                    const open = gates.get(k);
                                    if (open) {
                                        gates.delete(k);
                                        rejects.delete(k);
                                        const value = { id: nextId++ };
                                        produced.push(value);
                                        open(value);
                                    }
                                    break;
                                }
                                case 'fail': {
                                    const rej = rejects.get(k);
                                    if (rej) { gates.delete(k); rejects.delete(k); rej(new Error('boom')); }
                                    break;
                                }
                                case 'invalidate':
                                    cache.invalidate(k);
                                    break;
                                case 'expire':
                                    // Push every outstanding deadline past its limit.
                                    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
                                    break;
                            }
                            await flush();
                            check(h);
                        }

                        // Drain: open whatever is still waiting, then let the
                        // deadlines fire, so nothing is judged mid-flight.
                        for (const [k, open] of [...gates]) {
                            gates.delete(k);
                            const value = { id: nextId++ };
                            produced.push(value);
                            open(value);
                        }
                        await flush();
                        await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
                        await flush();
                        await Promise.allSettled(inFlight);
                        check(h);

                        // Every value a loader produced either reached a caller,
                        // sits in the cache, or was disposed. None may be adrift.
                        for (const value of produced) {
                            const reachable = delivered.includes(value)
                                || disposed.includes(value)
                                || KEYS.some((k) => cache.get(k) === value);
                            if (!reachable) {
                                throw new Error(
                                    `value ${value.id} is adrift: no caller got it, the cache does not hold it, `
                                    + 'and it was never disposed',
                                );
                            }
                        }
                        expect(cache.sizes().pending, 'a load never settled').toBe(0);
                    } finally {
                        RuntimeConfig.assetLoadTimeout = previous;
                    }
                },
            ),
            { numRuns: RUNS, seed: SEED, verbose: true },
        );
    }, 300_000);
});
