// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Quantized replicated fields, and the variable-length row header.
 *
 * A quantized number travels as a whole number of steps. Both endpoints use
 * the same step. An exact spawn can need one correction inside its initial
 * cell. Once on the grid, crossing a cell boundary produces the next update.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent, Name } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import {
    replicationPlugin, Net, Replicated, ByteWriter, ByteReader, encodeValue, decodeValue,
    buildReplicationTable, tableSchemas, diffSchemas, FrameWriter, decodeStateFrame,
    quantizeReplicatedFields, type FieldShape,
} from '../src/net/replication';
import type { Entity } from '../src/types';

const STEP = 1 / 60;
let Spot: ReturnType<typeof defineComponent<{ at: { x: number; y: number }; hp: number; tag: string }>>;

beforeEach(() => {
    clearUserComponents();
    Spot = defineComponent('Spot', { at: { x: 0, y: 0 }, hp: 0, tag: '' }, { replicatedFields: ['at', 'hp', 'tag'] });
});
afterEach(() => quantizeReplicatedFields('Spot', {}));

describe('the row header is variable-length', () => {
    it('round-trips whole numbers across every byte boundary up to 2^53', () => {
        const values = [0, 1, 127, 128, 16383, 16384, 2 ** 31 - 1, 2 ** 31, 2 ** 32 + 5, 2 ** 53 - 1];
        const w = new ByteWriter();
        for (const v of values) w.varint(v);
        const r = new ByteReader(w.finish());
        for (const v of values) expect(r.varint()).toBe(v);
        expect(r.remaining).toBe(0);
    });

    it('spends one byte on each of a small row header', () => {
        const table = buildReplicationTable();
        const te = table.byName.get('Spot')!;
        const fw = new FrameWriter(1);
        const empty = fw.byteLength;
        fw.entry(100, te, 0b010, { at: { x: 0, y: 0 }, hp: 5, tag: '' });
        // netId, component id, mask: one byte each; hp: a 4-byte float.
        expect(fw.byteLength - empty).toBe(3 + 4);
        const frame = decodeStateFrame(fw.finish(), table);
        expect(frame.entries[0]).toMatchObject({ netId: 100, componentId: te.id, fieldMask: 0b010, values: [5] });
    });
});

describe('quantizeReplicatedFields', () => {
    it('sends the nearest multiple of the step, either sign, in fewer bytes', () => {
        const shape: FieldShape = { kind: 'f32', step: 0.5 };
        const values = [0, 1.2, -1.2, 1.25, -1000.74, 3e6];
        const w = new ByteWriter();
        for (const v of values) encodeValue(w, shape, v);
        expect(w.length).toBeLessThan(values.length * 4);
        const r = new ByteReader(w.finish());
        for (const v of values) {
            const got = decodeValue(r, shape) as number;
            expect(Math.abs(got - v)).toBeLessThanOrEqual(0.25);
            expect(got / 0.5).toBe(Math.round(got / 0.5));
        }
    });

    it('quantizes every number in an object field and names the step in the schema', () => {
        quantizeReplicatedFields('Spot', { at: 0.01 });
        const te = buildReplicationTable().byName.get('Spot')!;
        const schema = tableSchemas(buildReplicationTable()).find((s) => s.name === 'Spot')!;
        expect(schema.shapes).toEqual(['{x:f32/0.01,y:f32/0.01}', 'f32', 'string']);
        const fw = new FrameWriter(1);
        fw.entry(1, te, 0b001, { at: { x: 12.3456, y: -0.004 }, hp: 0, tag: '' });
        const [entry] = decodeStateFrame(fw.finish(), buildReplicationTable()).entries;
        const at = entry!.values[0] as { x: number; y: number };
        expect(at.x).toBeCloseTo(12.35, 5);
        expect(at.y).toBeCloseTo(0, 5);
    });

    it('lets the handshake see two ends with different steps', () => {
        const plain = tableSchemas(buildReplicationTable());
        quantizeReplicatedFields('Spot', { hp: 1 });
        const stepped = tableSchemas(buildReplicationTable());
        expect(diffSchemas(stepped, plain)).toMatch(/Spot.*hp.*f32\/1.*f32/);
    });

    it('refuses a step that is not a positive number, and fields that cannot take one', () => {
        expect(() => quantizeReplicatedFields('Spot', { hp: 0 })).toThrow(RangeError);
        expect(() => quantizeReplicatedFields('Spot', { hp: Number.NaN })).toThrow(RangeError);
        quantizeReplicatedFields('Spot', { nope: 1 });
        expect(() => buildReplicationTable()).toThrow(/not one of its replicated fields/);
        quantizeReplicatedFields('Spot', { tag: 1 });
        expect(() => buildReplicationTable()).toThrow(/holds no number/);
    });
});

describe('a quantized field on the wire', () => {
    async function serverAndClient() {
        const serverApp = App.new();
        serverApp.addPlugin(replicationPlugin);
        const server = serverApp.getResource(Net).startServer();
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        await app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 });
        const e = serverApp.world.spawn('spot');
        serverApp.world.insert(e, Spot, { at: { x: 0, y: 0 }, hp: 0, tag: '' });
        serverApp.world.insert(e, Replicated, {});
        const step = async () => { await serverApp.tick(STEP); await app.tick(STEP); };
        const ghostAt = (): { x: number; y: number } => {
            const g = app.world.getEntitiesWithComponents([Replicated])
                .find((x) => (app.world.tryGet(x, Name) as { value: string } | null)?.value === 'spot') as Entity;
            return (app.world.tryGet(g, Spot) as { at: { x: number; y: number } }).at;
        };
        return { serverApp, app, server, e, step, ghostAt };
    }

    it('sends drift under a step only when it crosses one, and the client stays within half a step', async () => {
        quantizeReplicatedFields('Spot', { at: 1 });
        const h = await serverAndClient();
        await h.step();
        const framesBefore = h.server.stats.stateFrames;
        let x = 0;
        for (let i = 0; i < 40; i++) {
            x += 0.1;
            h.serverApp.world.update(h.e, Spot, (d) => { (d as { at: { x: number } }).at = { x, y: 0 } as never; });
            await h.step();
            expect(Math.abs(h.ghostAt().x - x)).toBeLessThanOrEqual(0.5 + 1e-6);
        }
        // Forty ticks of a tenth of a step: four steps crossed, four frames.
        expect(h.server.stats.stateFrames - framesBefore).toBe(4);
    });

    it('uses the encoder fallback when comparing unrepresentable step indices', async () => {
        quantizeReplicatedFields('Spot', { hp: 1 });
        const h = await serverAndClient();
        await h.step();
        const set = async (hp: number) => {
            h.serverApp.world.update(h.e, Spot, d => { d.hp = hp; });
            await h.step();
        };
        const before = h.server.stats.stateFrames;
        await set(1);
        await set(2 ** 52);
        expect(h.server.stats.stateFrames - before).toBe(2);
        const ghost = h.app.world.findEntityByName('spot')!;
        expect(h.app.world.get(ghost, Spot).hp).toBe(0);
        await set(-(2 ** 53));
        expect(h.server.stats.stateFrames - before).toBe(2);
        await set(-2);
        expect(h.app.world.get(ghost, Spot).hp).toBe(-2);
    });

    it('refuses a client whose steps are not the server’s', async () => {
        quantizeReplicatedFields('Spot', { hp: 1 });
        const serverApp = App.new();
        serverApp.addPlugin(replicationPlugin);
        const server = serverApp.getResource(Net).startServer();
        void server.table; // built on first use, and fixed from then on
        quantizeReplicatedFields('Spot', {});
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const [ta, tb] = MemoryTransport.pair();
        server.attachConnection(ta);
        await expect(app.getResource(Net).connect(tb, { interpolationDelayTicks: 0 })).rejects.toThrow(/hp/);
    });
});
