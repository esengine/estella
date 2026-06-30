// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    computeStreaming,
    SceneStreamingController,
    type StreamCell,
    type SceneStreamHost,
} from '../src/sceneStreaming';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function mockHost() {
    const loaded = new Set<string>();
    const sleeping = new Set<string>();
    const calls: string[] = [];
    const host: SceneStreamHost = {
        loadAdditive(n) { calls.push(`load:${n}`); loaded.add(n); sleeping.delete(n); return Promise.resolve({}); },
        unload(n) { calls.push(`unload:${n}`); loaded.delete(n); return Promise.resolve(); },
        sleep(n) { calls.push(`sleep:${n}`); sleeping.add(n); },
        wake(n) { calls.push(`wake:${n}`); sleeping.delete(n); },
        isLoaded: (n) => loaded.has(n),
        isSleeping: (n) => sleeping.has(n),
    };
    return { host, loaded, sleeping, calls };
}

const cells = (...cs: StreamCell[]) => cs;

describe('computeStreaming', () => {
    const a: StreamCell = { scene: 'a', x: 0, y: 0, radius: 0 };

    it('activates a cell whose edge is within loadRadius', () => {
        const d = computeStreaming(cells(a), 5, 0, 10, 20, new Set());
        expect(d.toActivate).toEqual(['a']);
        expect(d.toDeactivate).toEqual([]);
    });

    it('does not activate a cell beyond loadRadius', () => {
        expect(computeStreaming(cells(a), 50, 0, 10, 20, new Set()).toActivate).toEqual([]);
    });

    it('measures distance to the cell edge (radius)', () => {
        const big: StreamCell = { scene: 'big', x: 0, y: 0, radius: 40 };
        // center is 45 away, but the edge is only 5 away → within loadRadius 10.
        expect(computeStreaming(cells(big), 45, 0, 10, 20, new Set()).toActivate).toEqual(['big']);
    });

    it('keeps an active cell inside the hysteresis band (load < edge ≤ unload)', () => {
        // edge 15 is past loadRadius 10 but within unloadRadius 20 → no change.
        const d = computeStreaming(cells(a), 15, 0, 10, 20, new Set(['a']));
        expect(d.toActivate).toEqual([]);
        expect(d.toDeactivate).toEqual([]);
    });

    it('deactivates an active cell past unloadRadius', () => {
        expect(computeStreaming(cells(a), 25, 0, 10, 20, new Set(['a'])).toDeactivate).toEqual(['a']);
    });
});

describe('SceneStreamingController', () => {
    const near: StreamCell = { scene: 'near', x: 0, y: 0, radius: 0 };

    it('loads a cell when the focus comes within range', async () => {
        const { host, calls, loaded } = mockHost();
        const c = new SceneStreamingController(host, { loadRadius: 10, unloadRadius: 20 });
        c.register(near);
        c.setFocus(100, 0);
        c.update();
        expect(calls).toEqual([]); // out of range
        c.setFocus(5, 0);
        c.update();
        await flush();
        expect(calls).toEqual(['load:near']);
        expect(loaded.has('near')).toBe(true);
        expect(c.getActive()).toEqual(['near']);
    });

    it('unloads a cell when the focus leaves (past unloadRadius)', async () => {
        const { host, calls, loaded } = mockHost();
        const c = new SceneStreamingController(host, { loadRadius: 10, unloadRadius: 20 });
        c.register(near);
        c.setFocus(5, 0); c.update(); await flush();
        c.setFocus(15, 0); c.update(); await flush(); // in the band → stays
        expect(loaded.has('near')).toBe(true);
        c.setFocus(25, 0); c.update(); await flush(); // past unload → drop
        expect(calls).toEqual(['load:near', 'unload:near']);
        expect(loaded.has('near')).toBe(false);
        expect(c.getActive()).toEqual([]);
    });

    it('sleep policy sleeps/wakes instead of unload/load', async () => {
        const { host, calls } = mockHost();
        const c = new SceneStreamingController(host, { loadRadius: 10, unloadRadius: 20, policy: 'sleep' });
        c.register(near);
        c.setFocus(5, 0); c.update(); await flush();   // load
        c.setFocus(25, 0); c.update(); await flush();  // sleep
        c.setFocus(5, 0); c.update(); await flush();   // wake
        expect(calls).toEqual(['load:near', 'sleep:near', 'wake:near']);
    });

    it('does not re-issue a load while one is in flight', async () => {
        const { host, calls } = mockHost();
        const c = new SceneStreamingController(host, { loadRadius: 10, unloadRadius: 20 });
        c.register(near);
        c.setFocus(5, 0);
        c.update();
        c.update(); // same tick range, still active → no second load
        await flush();
        expect(calls).toEqual(['load:near']);
    });

    it('clamps unloadRadius up to loadRadius', () => {
        const { host } = mockHost();
        const c = new SceneStreamingController(host, { loadRadius: 30, unloadRadius: 10 });
        c.register(near);
        c.setFocus(20, 0); // within load(30)
        c.update();
        // unload clamped to 30, so at edge 20 (≤30) it must NOT immediately deactivate.
        expect(c.getActive()).toEqual(['near']);
    });
});
