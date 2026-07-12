// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Reactive data binding: signals notify, derived recomputes, and bind
 *        drives a component field from a signal (seed, track, auto-dispose).
 */
import { describe, it, expect } from 'vitest';
import { signal, derived, bind, Text } from '../src/ui';
import type { Entity } from '../src/types';
import type { World } from '../src/world';

function mockWorld() {
    const comps = new Map<number, Map<object, unknown>>();
    const despawnCbs: Array<(e: number) => void> = [];
    let next = 1;
    const w = {
        spawn(): Entity { const e = next++; comps.set(e, new Map()); return e as Entity; },
        despawn(e: Entity) { comps.delete(e as number); [...despawnCbs].forEach((cb) => cb(e as number)); },
        valid(e: Entity) { return comps.has(e as number); },
        has(e: Entity, c: object) { return comps.get(e as number)?.has(c) ?? false; },
        get(e: Entity, c: object) { return comps.get(e as number)?.get(c); },
        insert(e: Entity, c: object, d: unknown) { comps.get(e as number)?.set(c, d); },
        onDespawn(cb: (e: number) => void) {
            despawnCbs.push(cb);
            return () => { const i = despawnCbs.indexOf(cb); if (i >= 0) despawnCbs.splice(i, 1); };
        },
    };
    return w as unknown as World;
}

describe('signal', () => {
    it('holds a value and notifies subscribers on change', () => {
        const s = signal(1);
        const seen: number[] = [];
        s.subscribe((v) => seen.push(v));
        expect(s.get()).toBe(1);
        s.set(2);
        s.update((p) => p + 10);
        expect(s.get()).toBe(12);
        expect(seen).toEqual([2, 12]);
    });

    it('an unchanged set is a no-op (no notification)', () => {
        const s = signal('a');
        let count = 0;
        s.subscribe(() => count++);
        s.set('a');
        expect(count).toBe(0);
    });

    it('unsubscribe stops delivery', () => {
        const s = signal(0);
        let count = 0;
        const off = s.subscribe(() => count++);
        s.set(1);
        off();
        s.set(2);
        expect(count).toBe(1);
    });
});

describe('derived', () => {
    it('recomputes from its sources', () => {
        const hp = signal(50);
        const max = signal(100);
        const pct = derived([hp, max], () => hp.get() / max.get());
        expect(pct.get()).toBe(0.5);
        const seen: number[] = [];
        pct.subscribe((v) => seen.push(v));
        hp.set(75);
        max.set(150);
        expect(pct.get()).toBe(0.5);
        expect(seen).toEqual([0.75, 0.5]);
    });
});

describe('bind', () => {
    it('seeds the field immediately and tracks the signal', () => {
        const w = mockWorld();
        const e = w.spawn();
        w.insert(e, Text, { content: 'x' });
        const label = signal('hello');
        bind(w, e, Text, 'content', label);
        expect((w.get(e, Text) as { content: string }).content).toBe('hello'); // seeded
        label.set('world');
        expect((w.get(e, Text) as { content: string }).content).toBe('world'); // tracks
    });

    it('dispose() stops further updates', () => {
        const w = mockWorld();
        const e = w.spawn();
        w.insert(e, Text, { content: '' });
        const label = signal('a');
        const dispose = bind(w, e, Text, 'content', label);
        dispose();
        label.set('b');
        expect((w.get(e, Text) as { content: string }).content).toBe('a');
    });

    it('auto-disposes when the entity despawns (no write, no throw)', () => {
        const w = mockWorld();
        const e = w.spawn();
        w.insert(e, Text, { content: '' });
        const label = signal('a');
        bind(w, e, Text, 'content', label);
        (w as unknown as { despawn(e: Entity): void }).despawn(e);
        expect(() => label.set('b')).not.toThrow();
    });

    it('skips the write when the entity lacks the component', () => {
        const w = mockWorld();
        const e = w.spawn(); // no Text inserted
        const label = signal('a');
        expect(() => bind(w, e, Text, 'content', label)).not.toThrow();
        expect(w.has(e, Text)).toBe(false); // never created it
    });
});
