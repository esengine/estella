// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Diagnostics: the properties that decide whether this can be left on.
 *
 * A crash reporter in a game engine is judged on how it behaves when things are
 * already going badly — a system throwing every frame, a sink that is itself
 * broken, an error whose message is different every time. Each of those has a
 * naive implementation that works fine in a demo and takes the game down in
 * production, so they are what this file is about.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiagnosticsAPI } from '../src/diagnostics/Diagnostics';
import { fingerprint, messageOf, stackOf } from '../src/diagnostics/events';
import type { DiagnosticEvent } from '../src/diagnostics/events';

const drain = (): { sink: (e: readonly DiagnosticEvent[]) => void; batches: DiagnosticEvent[][] } => {
    const batches: DiagnosticEvent[][] = [];
    return { sink: (e) => { batches.push([...e]); }, batches };
};

describe('aggregation', () => {
    it('collapses repeats of one problem into a single event with a count', () => {
        const api = new DiagnosticsAPI();
        for (let i = 0; i < 500; i++) {
            api.report({ kind: 'engine', message: 'System "Move" threw an error', source: 'app' });
        }
        expect(api.events).toHaveLength(1);
        expect(api.events[0].count).toBe(500);
        expect(api.events[0].lastAt).toBeGreaterThanOrEqual(api.events[0].firstAt);
    });

    it('keeps genuinely different problems apart', () => {
        const api = new DiagnosticsAPI();
        api.report({ kind: 'engine', message: 'texture missing', source: 'assets' });
        api.report({ kind: 'engine', message: 'texture missing', source: 'render' });
        api.report({ kind: 'unhandled', message: 'texture missing', source: 'assets' });
        expect(api.events).toHaveLength(3);
    });

    it('does not treat an id in the message as a new problem every time', () => {
        // "Entity 41 has no Transform" repeated across a thousand entities is one
        // bug, and a reporter that files a thousand events has hidden it.
        const api = new DiagnosticsAPI();
        for (let id = 0; id < 100; id++) {
            api.report({ kind: 'engine', message: `Entity ${id} has no Transform`, source: 'app' });
        }
        expect(api.events).toHaveLength(1);
        expect(api.events[0].count).toBe(100);
    });

    it('splits on the throw site, not on the whole stack', () => {
        // Same message, same first frame, different callers below it: one bug.
        const deep = (tail: string): Error => {
            const e = new Error('boom');
            e.stack = `Error: boom\n    at doWork (game.js:10:5)\n    at ${tail}`;
            return e;
        };
        const api = new DiagnosticsAPI();
        api.report({ kind: 'engine', message: 'boom', error: deep('a (game.js:1:1)') });
        api.report({ kind: 'engine', message: 'boom', error: deep('b (game.js:2:2)') });
        expect(api.events).toHaveLength(1);

        // A different throw site IS a different bug.
        const other = new Error('boom');
        other.stack = 'Error: boom\n    at somewhereElse (game.js:99:1)';
        api.report({ kind: 'engine', message: 'boom', error: other });
        expect(api.events).toHaveLength(2);
    });

    it('caps distinct events, keeping the cause rather than the cascade', () => {
        const api = new DiagnosticsAPI({ maxDistinct: 3 });
        for (let i = 0; i < 10; i++) api.report({ kind: 'engine', message: `problem ${i}`, source: `s${i}` });
        expect(api.events.map((e) => e.source)).toEqual(['s0', 's1', 's2']);
        expect(api.dropped).toBe(7);
        // A capped aggregator still counts what it already knows.
        api.report({ kind: 'engine', message: 'problem 0', source: 's0' });
        expect(api.events[0].count).toBe(2);
    });

    it('carries the newest context, since that is the state to reproduce', () => {
        const api = new DiagnosticsAPI();
        api.report({ kind: 'game', message: 'save failed', context: { attempt: 1 } });
        api.report({ kind: 'game', message: 'save failed', context: { attempt: 2 } });
        expect(api.events[0].context).toEqual({ attempt: 2 });
        expect(api.events[0].count).toBe(2);
    });
});

describe('the sink', () => {
    it('is absent by default — the engine picks no destination', () => {
        const api = new DiagnosticsAPI();
        api.report({ kind: 'game', message: 'x' });
        // Still aggregated and readable locally; simply not sent.
        expect(api.events).toHaveLength(1);
        expect(() => api.flush()).not.toThrow();
    });

    it('receives distinct events with counts, not occurrences', () => {
        const { sink, batches } = drain();
        const api = new DiagnosticsAPI();
        api.setSink(sink);
        for (let i = 0; i < 3; i++) api.report({ kind: 'engine', message: 'same' });
        api.flush();
        expect(batches).toHaveLength(1);
        expect(batches[0]).toHaveLength(1);
        expect(batches[0][0].count).toBe(3);
    });

    it('hands over what accumulated before it was installed', () => {
        const { sink, batches } = drain();
        const api = new DiagnosticsAPI();
        api.report({ kind: 'engine', message: 'happened during boot' });
        api.setSink(sink);
        expect(batches[0][0].message).toBe('happened during boot');
    });

    it('starts a new window after a flush', () => {
        const { sink, batches } = drain();
        const api = new DiagnosticsAPI();
        api.setSink(sink);
        api.report({ kind: 'engine', message: 'a' });
        api.flush();
        api.report({ kind: 'engine', message: 'a' });
        api.flush();
        expect(batches).toHaveLength(2);
        expect(batches[1][0].count).toBe(1);   // not 2 — the window restarted
    });

    it('survives a sink that throws, and does not report its failure', () => {
        // The trap this guards: reporting a broken sink goes through the logger,
        // the logger is what feeds this, and the game spins until it dies.
        const api = new DiagnosticsAPI();
        let calls = 0;
        api.setSink(() => { calls++; throw new Error('the reporting service is down'); });
        api.report({ kind: 'engine', message: 'a real bug' });
        expect(() => api.flush()).not.toThrow();
        expect(calls).toBe(1);
        expect(api.events).toHaveLength(0);   // the batch is gone, not retried forever
    });

    it('ignores anything reported from inside the sink', () => {
        const api = new DiagnosticsAPI();
        let depth = 0;
        let maxDepth = 0;
        api.setSink(() => {
            depth++;
            maxDepth = Math.max(maxDepth, depth);
            api.report({ kind: 'engine', message: 'reported from inside the sink' });
            api.flush();
            depth--;
        });
        api.report({ kind: 'engine', message: 'first' });
        api.flush();
        expect(maxDepth).toBe(1);
        expect(api.events).toHaveLength(0);
    });
});

describe('flush cadence', () => {
    it('flushes on the engine clock, not a timer', () => {
        const { sink, batches } = drain();
        const api = new DiagnosticsAPI({ flushIntervalSec: 10 });
        api.setSink(sink);
        api.report({ kind: 'engine', message: 'a' });
        api.tick(4);
        expect(batches).toHaveLength(0);
        api.tick(4);
        expect(batches).toHaveLength(0);
        api.tick(4);
        expect(batches).toHaveLength(1);
    });

    it('does not tick the clock forward with nothing to send', () => {
        const { sink, batches } = drain();
        const api = new DiagnosticsAPI({ flushIntervalSec: 1 });
        api.setSink(sink);
        api.tick(60);                                   // an hour of quiet
        api.report({ kind: 'engine', message: 'a' });
        api.tick(0.5);
        expect(batches).toHaveLength(0);                // …does not make this urgent
        api.tick(0.6);
        expect(batches).toHaveLength(1);
    });
});

describe('what was thrown', () => {
    it('tolerates a thrown non-Error, which is legal and does ship', () => {
        const api = new DiagnosticsAPI();
        api.reportError('unhandled', 'nope');
        expect(api.events[0].message).toBe('nope');
        expect(api.events[0].stack).toBeUndefined();
    });

    it('reads a cross-realm error, which fails instanceof but has the fields', () => {
        // A WeChat sub-context or an iframe throws these; `instanceof Error` is
        // false and JSON.stringify renders `{}`.
        const alien = { message: 'from another realm', stack: 'Error: from another realm\n    at x (a.js:1:1)' };
        expect(messageOf(alien)).toBe('from another realm');
        expect(stackOf(alien)).toContain('at x');
        const api = new DiagnosticsAPI();
        api.reportError('unhandled', alien, 'host');
        expect(api.events[0].source).toBe('host');
        expect(api.events[0].stack).toBeDefined();
    });

    it('fingerprints identically for the same problem reported twice', () => {
        const report = { kind: 'engine' as const, message: 'x', source: 'app' };
        expect(fingerprint(report)).toBe(fingerprint({ ...report }));
    });
});

describe('the log bridge', () => {
    let api: DiagnosticsAPI;
    let plugin: { build: (app: unknown) => void; cleanup: (app: unknown) => void };

    beforeEach(async () => {
        const { DiagnosticsPlugin } = await import('../src/diagnostics/DiagnosticsPlugin');
        const p = new DiagnosticsPlugin();
        const resources = new Map<unknown, unknown>();
        const app = {
            insertResource: (key: unknown, value: unknown) => { resources.set(key, value); },
            getResource: (key: unknown) => resources.get(key),
            addSystemToSchedule: () => {},
        };
        p.build(app as never);
        const { Diagnostics } = await import('../src/diagnostics/Diagnostics');
        api = app.getResource(Diagnostics) as DiagnosticsAPI;
        plugin = { build: () => {}, cleanup: () => p.cleanup(app as never) };
    });

    afterEach(() => { plugin.cleanup(null); });

    it('collects every engine error without taking a handler from the game', async () => {
        const { log } = await import('../src/util/logger');
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        log.error('physics', 'the world could not step', new Error('bad body'));
        spy.mockRestore();
        expect(api.events).toHaveLength(1);
        expect(api.events[0].source).toBe('physics');
        expect(api.events[0].kind).toBe('engine');
    });

    it('leaves warnings out by default — a handled problem is not a report', async () => {
        const { log } = await import('../src/util/logger');
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        log.warn('assets', 'texture missing, using placeholder');
        spy.mockRestore();
        expect(api.events).toHaveLength(0);
    });

    it('stops listening once the plugin is cleaned up', async () => {
        const { log } = await import('../src/util/logger');
        plugin.cleanup(null);
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        log.error('physics', 'after shutdown');
        spy.mockRestore();
        expect(api.events).toHaveLength(0);
    });
});
