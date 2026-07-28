// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  RC11 N3: ghost snapshot interpolation. The render clock trails the
 *        newest server tick; continuous fields lerp between bracketing
 *        samples, discrete fields hold, and bursty delivery (jitter) bends
 *        the clock instead of teleporting the ghost.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { defineComponent, clearUserComponents } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import {
    replicationPlugin, Net, Replicated,
    lerpValue, InterpolationState,
} from '../src/net/replication';

const STEP = 1 / 60;

let NetPos: ReturnType<typeof defineComponent<{ x: number; y: number; mode: string }>>;

beforeEach(() => {
    clearUserComponents();
    NetPos = defineComponent('NetPos', { x: 0, y: 0, mode: '' }, {
        replicatedFields: ['x', 'y', 'mode'],
    });
});

function makeApp(): App {
    const app = App.new();
    app.addPlugin(replicationPlugin);
    return app;
}

describe('lerpValue', () => {
    it('lerps f32 scalars and f32 leaves of vectors', () => {
        expect(lerpValue({ kind: 'f32' }, 0, 10, 0.25)).toBe(2.5);
        const vec = lerpValue(
            { kind: 'object', keys: ['x', 'y'], shapes: [{ kind: 'f32' }, { kind: 'f32' }] },
            { x: 0, y: 100 }, { x: 10, y: 200 }, 0.5,
        );
        expect(vec).toEqual({ x: 5, y: 150 });
    });

    it('nlerps quaternions through the shorter cover', () => {
        const shape = { kind: 'object', keys: ['x', 'y', 'z', 'w'], shapes: Array(4).fill({ kind: 'f32' }) } as const;
        const a = { x: 0, y: 0, z: 0, w: 1 };
        const b = { x: 0, y: 0, z: 0, w: -1 }; // same rotation, opposite cover
        const mid = lerpValue(shape as never, a, b, 0.5) as Record<string, number>;
        // Nlerp negates the far cover: stays the identity, never a degenerate zero quat.
        expect(mid.w).toBeCloseTo(1);
        expect(Math.hypot(mid.x, mid.y, mid.z, mid.w)).toBeCloseTo(1);
    });

    it('holds discrete values at the older sample', () => {
        expect(lerpValue({ kind: 'string' }, 'walk', 'run', 0.9)).toBe('walk');
        expect(lerpValue({ kind: 'bool' }, true, false, 0.9)).toBe(true);
    });
});

describe('InterpolationState', () => {
    it('samples between sparse per-field samples and holds past the newest', () => {
        const s = new InterpolationState(2);
        s.push(1, 0, 0, 10, 100); // netId 1, comp 0, field 0
        s.push(1, 0, 0, 14, 300); // sparse: nothing at 11-13
        s.newestTick = 14;
        const buf = s.buffers.get(1)!.get(0)!;
        const series = buf.byField.get(0)!;
        expect(series.sample({ kind: 'f32' }, 12)).toBe(200);
        expect(series.sample({ kind: 'f32' }, 14)).toBe(300);
        expect(series.sample({ kind: 'f32' }, 99)).toBe(300); // hold
        expect(series.sample({ kind: 'f32' }, 5)).toBeUndefined(); // before history
    });

    it('the render clock trails newest data and converges onto it when quiet', () => {
        const s = new InterpolationState(2);
        s.push(7, 0, 0, 10, 1);
        let t = s.advance(1);
        expect(t).toBe(8); // first advance snaps to newest - delay
        for (let i = 0; i < 60; i++) t = s.advance(1);
        expect(t).toBe(10); // clamped at the newest tick — final state presented
    });
});

describe('ghost interpolation end-to-end', () => {
    async function movingPair() {
        const serverApp = makeApp();
        const clientApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        await clientApp.getResource(Net).connect(tb); // default delay: 2 ticks
        return { serverApp, clientApp };
    }

    it('a moving ghost trails the server smoothly and converges when motion stops', async () => {
        const { serverApp, clientApp } = await movingPair();

        const e = serverApp.world.spawn('mover');
        serverApp.world.insert(e, Replicated, {});
        serverApp.world.insert(e, NetPos, { x: 0, y: 0, mode: 'walk' });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])[0];

        const samples: number[] = [];
        let serverX = 0;
        for (let i = 0; i < 12; i++) {
            serverX += 10;
            const pos = serverApp.world.tryGet(e, NetPos)!;
            pos.x = serverX;
            serverApp.world.set(e, NetPos, pos);
            await serverApp.tick(STEP);
            await clientApp.tick(STEP);
            samples.push(clientApp.world.tryGet(ghost, NetPos)!.x);
        }

        // Monotone, never ahead of the authority, and actually moving.
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
        }
        expect(samples[samples.length - 1]).toBeLessThanOrEqual(serverX);
        expect(samples[samples.length - 1]).toBeGreaterThan(0);
        // Trails by roughly the interpolation delay while moving.
        expect(samples[samples.length - 1]).toBeLessThan(serverX);

        // Server goes quiet → the ghost converges onto the exact final value.
        for (let i = 0; i < 90; i++) await clientApp.tick(STEP);
        expect(clientApp.world.tryGet(ghost, NetPos)!.x).toBe(serverX);
    });

    it('bursty delivery still presents monotone motion', async () => {
        const serverApp = makeApp();
        const clientApp = makeApp();
        const server = serverApp.getResource(Net).startServer();
        const [ta, tb] = MemoryTransport.pair({ manualFlush: true });
        server.attachConnection(ta);
        const connectP = clientApp.getResource(Net).connect(tb);
        for (let i = 0; i < 8; i++) { ta.flush(); tb.flush(); await Promise.resolve(); }
        await connectP;

        const e = serverApp.world.spawn('jittery');
        serverApp.world.insert(e, Replicated, {});
        serverApp.world.insert(e, NetPos, { x: 0, y: 0, mode: '' });
        await serverApp.tick(STEP);
        ta.flush();
        await clientApp.tick(STEP);
        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])[0];

        const samples: number[] = [];
        let serverX = 0;
        for (let burst = 0; burst < 4; burst++) {
            // Three server ticks arrive as one burst (network jitter).
            for (let i = 0; i < 3; i++) {
                serverX += 10;
                const pos = serverApp.world.tryGet(e, NetPos)!;
                pos.x = serverX;
                serverApp.world.set(e, NetPos, pos);
                await serverApp.tick(STEP);
            }
            ta.flush();
            for (let i = 0; i < 3; i++) {
                await clientApp.tick(STEP);
                samples.push(clientApp.world.tryGet(ghost, NetPos)!.x);
            }
        }

        for (let i = 1; i < samples.length; i++) {
            expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
        }
        expect(samples[samples.length - 1]).toBeGreaterThan(0);
        expect(samples[samples.length - 1]).toBeLessThanOrEqual(serverX);
    });

    it('discrete fields step to their sample value, never blend', async () => {
        const { serverApp, clientApp } = await movingPair();
        const e = serverApp.world.spawn('walker');
        serverApp.world.insert(e, Replicated, {});
        serverApp.world.insert(e, NetPos, { x: 0, y: 0, mode: 'walk' });
        await serverApp.tick(STEP);
        await clientApp.tick(STEP);
        const ghost = clientApp.world.getEntitiesWithComponents([Replicated])[0];

        const pos = serverApp.world.tryGet(e, NetPos)!;
        pos.mode = 'run';
        serverApp.world.set(e, NetPos, pos);
        await serverApp.tick(STEP);

        const seen = new Set<string>();
        for (let i = 0; i < 60; i++) {
            await clientApp.tick(STEP);
            seen.add(clientApp.world.tryGet(ghost, NetPos)!.mode);
        }
        // Only ever the two authored values — and it does arrive.
        expect([...seen].every((m) => m === 'walk' || m === 'run')).toBe(true);
        expect(seen.has('run')).toBe(true);
    });
});
