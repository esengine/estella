// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { NetChannel, type PayloadCodec } from '../src/net/NetChannel';
import { MemoryIdempotencyStore } from '../src/net/IdempotencyStore';
import { MemoryTransport } from '../src/net/MemoryTransport';
import { CONTROL_CHANNEL, decodeEnvelope, encodeEnvelope } from '../src/net/wire';
import { ClientSession } from '../src/net/session/ClientSession';
import { SessionHost, type AcceptedConnection, type SessionContext } from '../src/net/session/SessionHost';
import { defineContract } from '../src/net/session/contract';
import { proto, type ProtoMessage } from '../src/net/session/proto';
import { s } from '../src/net/session/schema';
import type { PlatformSocket, PlatformSocketEvents } from '../src/platform/types';

interface Item { n: number; name: string }

/** A message written by hand: one byte for `n`, then the name. Stands for a generated one. */
const item: ProtoMessage<Item> = {
    shape: 'Item{1:uint32 n,2:string name}',
    encode: (v) => Uint8Array.from([v.n, ...new TextEncoder().encode(v.name)]),
    decode: (b) => {
        if (b.length < 1) throw new Error('Item is empty');
        return { n: b[0]!, name: new TextDecoder().decode(b.subarray(1)) };
    },
    toJSON: (v) => ({ n: v.n, name: v.name }),
    fromJSON: (j) => {
        const o = j as Partial<Item> | null;
        if (!o || typeof o.n !== 'number' || typeof o.name !== 'string') throw new Error('not an Item');
        return { n: o.n, name: o.name };
    },
};

type Frame = string | ArrayBuffer;

/** Two channels over a pipe that records every frame. */
function pair(opts: ConstructorParameters<typeof NetChannel>[1] = {}) {
    const [ta, tb] = MemoryTransport.pair();
    const frames: Frame[] = [];
    const tap = (t: MemoryTransport) => {
        const send = t.send.bind(t);
        t.send = (d: Frame) => { frames.push(d); send(d); };
    };
    tap(ta);
    const a = new NetChannel(ta);
    const b = new NetChannel(tb, opts);
    return { a, b, frames };
}

describe('the binary envelope', () => {
    it('round-trips every field', () => {
        const frame = new Uint8Array(encodeEnvelope({ kind: 'req', type: 'order:place', id: 7, key: 'k-1', payload: Uint8Array.from([1, 2, 3]) }));
        expect(frame[0]).toBe(CONTROL_CHANNEL);
        expect(decodeEnvelope(frame.subarray(1))).toEqual({ kind: 'req', type: 'order:place', id: 7, key: 'k-1', payload: Uint8Array.from([1, 2, 3]) });
        const failed = new Uint8Array(encodeEnvelope({ kind: 'res', id: 7, error: 'boom' }));
        expect(decodeEnvelope(failed.subarray(1))).toEqual({ kind: 'res', id: 7, error: 'boom' });
    });

    it('keeps "no value" apart from "an empty value"', () => {
        const none = decodeEnvelope(new Uint8Array(encodeEnvelope({ kind: 'res', id: 1 })).subarray(1))!;
        const empty = decodeEnvelope(new Uint8Array(encodeEnvelope({ kind: 'res', id: 1, payload: new Uint8Array(0) })).subarray(1))!;
        expect(none.payload).toBeUndefined();
        expect(empty.payload).toEqual(new Uint8Array(0));
    });

    it('is null for anything that is not an envelope, and never throws', () => {
        for (const bad of [[], [0x08], [0x08, 0x09], [0x12, 0x40, 0x41], [0x08, 0x01, 0x80], [0x0f], [0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]]) {
            expect(decodeEnvelope(Uint8Array.from(bad)), JSON.stringify(bad)).toBeNull();
        }
        // text that is not UTF-8 in the type
        expect(decodeEnvelope(Uint8Array.from([0x08, 0x01, 0x12, 0x01, 0xff]))).toBeNull();
    });

    it('skips fields it does not know', () => {
        const base = new Uint8Array(encodeEnvelope({ kind: 'event', type: 'x' })).subarray(1);
        const withExtra = Uint8Array.from([...base, 0x98, 0x06, 0x05, 0xa2, 0x06, 0x01, 0x41]);
        expect(decodeEnvelope(withExtra)).toEqual({ kind: 'event', type: 'x' });
    });
});

describe('a channel on the protobuf wire', () => {
    it('writes binary frames on the control channel and reads them back', async () => {
        const { a, b, frames } = pair();
        a.setWire('pb');
        b.handle<Item, Item>('echo', (v) => ({ n: v.n + 1, name: v.name.toUpperCase() }), { req: item, res: item });
        const got = await a.request<Item, Item>('echo', { n: 4, name: 'abc' }, { codec: { req: item, res: item } });
        expect(got).toEqual({ n: 5, name: 'ABC' });
        const first = frames[0] as ArrayBuffer;
        expect(first).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(first)[0]).toBe(CONTROL_CHANNEL);
        // the payload on the wire is the codec's bytes, not JSON text
        expect(Buffer.from(first).includes(Buffer.from([4, 0x61, 0x62, 0x63]))).toBe(true);
    });

    it('answers in the wire the request came on: each side reads both', async () => {
        const { a, b } = pair();
        a.setWire('pb');
        b.setWire('json');
        b.handle<Item, Item>('echo', (v) => v, { req: item, res: item });
        expect(await a.request('echo', { n: 1, name: 'x' }, { codec: { req: item, res: item } })).toEqual({ n: 1, name: 'x' });
    });

    it('carries events, with a codec and without one', () => {
        const { a, b } = pair();
        a.setWire('pb');
        const seen: unknown[] = [];
        b.on<Item>('item', (v) => seen.push(v), item);
        b.on('plain', (v) => seen.push(v));
        a.send('item', { n: 9, name: 'z' }, item);
        a.send('plain', { any: ['thing', 1, null] });
        expect(seen).toEqual([{ n: 9, name: 'z' }, { any: ['thing', 1, null] }]);
    });

    it('uses the JSON form of a codec on the JSON wire, and checks it', async () => {
        const { a, b, frames } = pair();
        b.handle<Item, Item>('echo', (v) => v, { req: item, res: item });
        expect(await a.request('echo', { n: 2, name: 'q' }, { codec: { req: item, res: item } })).toEqual({ n: 2, name: 'q' });
        expect(typeof frames[0]).toBe('string');
        // a request that is not an Item is refused before the handler sees it
        await expect(a.request('echo', { n: 'two' }, { codec: { req: { ...item, toJSON: (v) => v }, res: item } })).rejects.toThrow(/invalid echo request: not an Item/);
    });

    it('refuses a payload the codec cannot read, as an answer to that request', async () => {
        const { a, b } = pair();
        a.setWire('pb');
        b.handle<Item, Item>('echo', (v) => v, { req: item, res: item });
        const empty: PayloadCodec<Item> = { ...item, encode: () => new Uint8Array(0) };
        await expect(a.request('echo', { n: 1, name: 'x' }, { codec: { req: empty, res: item } })).rejects.toThrow(/invalid echo request: Item is empty/);
    });

    it('answers a retried request from memory, in either wire, running the handler once', async () => {
        const store = new MemoryIdempotencyStore();
        const { a, b } = pair({ idempotency: store });
        let runs = 0;
        b.handle<Item, Item>('place', (v) => { runs++; return { n: runs, name: v.name }; }, { req: item, res: item });
        const codec = { req: item, res: item };
        a.setWire('pb');
        const first = await a.request<Item, Item>('place', { n: 1, name: 'o' }, { codec, idempotencyKey: 'k' });
        a.setWire('json');
        const again = await a.request<Item, Item>('place', { n: 1, name: 'o' }, { codec, idempotencyKey: 'k' });
        expect(runs).toBe(1);
        expect(again).toEqual(first);
    });

    it('keeps a retried answer in JSON form, so a store that serialises it can still replay it', async () => {
        interface Blob { blob: Uint8Array }
        const blobCodec: PayloadCodec<Blob> = {
            encode: (v) => v.blob,
            decode: (b) => ({ blob: b }),
            toJSON: (v) => ({ blob: Array.from(v.blob) }),
            fromJSON: (j) => ({ blob: Uint8Array.from((j as { blob: number[] }).blob) }),
        };
        // what a database does to a value on its way in and out
        class Serialising extends MemoryIdempotencyStore {
            override finish(key: string, outcome: { d?: unknown }) { return super.finish(key, JSON.parse(JSON.stringify(outcome))); }
        }
        const { a, b } = pair({ idempotency: new Serialising() });
        let runs = 0;
        b.handle<Blob, Blob>('get', () => { runs++; return { blob: Uint8Array.from([7, 8, 9]) }; }, { req: blobCodec, res: blobCodec });
        const codec = { req: blobCodec, res: blobCodec };
        a.setWire('pb');
        const first = await a.request<Blob, Blob>('get', { blob: new Uint8Array(0) }, { codec, idempotencyKey: 'k' });
        const again = await a.request<Blob, Blob>('get', { blob: new Uint8Array(0) }, { codec, idempotencyKey: 'k' });
        expect(runs).toBe(1);
        expect(Array.from(first.blob)).toEqual([7, 8, 9]);
        expect(Array.from(again.blob)).toEqual([7, 8, 9]);
    });

    it('limits control messages whichever wire they came on', () => {
        const violations: string[] = [];
        const { a, b } = pair({ limits: { messagesPerSecond: 1, burst: 2, onViolation: (k) => violations.push(k) } });
        a.setWire('pb');
        let seen = 0;
        b.on('e', () => seen++);
        for (let i = 0; i < 5; i++) a.send('e', i);
        expect(seen).toBe(2);
        expect(violations).toEqual(['rate', 'rate', 'rate']);
    });

    it('drops JSON frames once the peer has agreed to protobuf, and says so', () => {
        const violations: string[] = [];
        const { a, b } = pair({ limits: { onViolation: (k) => violations.push(k) } });
        b.setWire('pb', { acceptJson: false });
        let seen = 0;
        b.on('e', () => seen++);
        a.send('e', 1);
        a.setWire('pb');
        a.send('e', 2);
        expect(seen).toBe(1);
        expect(violations).toEqual(['wire']);
    });

    it('keeps channel 255 for itself', () => {
        const { a } = pair();
        expect(() => a.sendBinary(CONTROL_CHANNEL, new Uint8Array(1))).toThrow(/reserved/);
        expect(() => a.onBinary(CONTROL_CHANNEL, () => undefined)).toThrow(/reserved/);
        expect(() => a.onBinary(254, () => undefined)).not.toThrow();
    });

    it('ignores a malformed control frame', () => {
        const { b } = pair();
        let seen = 0;
        b.on('e', () => seen++);
        (b as unknown as { handleIncoming_(d: ArrayBuffer): void }).handleIncoming_(Uint8Array.from([CONTROL_CHANNEL, 0x08, 0x63]).buffer);
        expect(seen).toBe(0);
    });
});

// ── a whole session ─────────────────────────────────────────────────────────────────────────────

interface Ctx extends SessionContext { name: string }

function network(host: SessionHost<Ctx>) {
    const frames: Frame[] = [];
    const socket = (): PlatformSocket => {
        const events = new Map<string, Set<(...a: never[]) => void>>();
        const emit = <K extends keyof PlatformSocketEvents>(e: K, ...a: PlatformSocketEvents[K]) =>
            events.get(e)?.forEach((f) => (f as (...x: PlatformSocketEvents[K]) => void)(...a));
        const toServer = new Set<(d: Frame) => void>();
        const closing = new Set<() => void>();
        let open = false;
        const shutdown = (code: number, reason: string) => {
            if (!open) return;
            open = false;
            client.readyState = 'closed';
            queueMicrotask(() => { emit('close', code, reason); closing.forEach((h) => h()); });
        };
        const client: PlatformSocket = {
            delivery: 'reliable-ordered',
            readyState: 'closed',
            on: (e, h) => { let set = events.get(e); if (!set) { set = new Set(); events.set(e, set); } set.add(h as never); return () => set!.delete(h as never); },
            connect: () => {
                client.readyState = 'connecting';
                queueMicrotask(() => { open = true; client.readyState = 'open'; host.accept(conn); emit('open'); });
            },
            send: (d) => { frames.push(d); if (open) queueMicrotask(() => { if (open) toServer.forEach((h) => h(d)); }); },
            close: (code = 1000, reason = '') => shutdown(code, reason),
        };
        const conn: AcceptedConnection = {
            transport: {
                send: (d) => { frames.push(d); if (open) queueMicrotask(() => { if (open) emit('message', d); }); },
                on: (_e, h) => { toServer.add(h); return () => toServer.delete(h); },
            },
            close: (code = 1000, reason = '') => shutdown(code, reason),
            onClose: (h) => { closing.add(h); return () => closing.delete(h); },
        };
        return client;
    };
    return { socket, frames };
}

const contract = defineContract({
    requests: {
        place: { req: proto(item, (v) => { if (v.n > 200) throw new Error('n is over 200'); }), res: proto(item) },
        legacy: { req: s.object({ a: s.int() }), res: s.object({ a: s.int() }) },
    },
    events: { tick: proto(item) },
});

function session(hostWire: 'json' | 'pb' | 'pb-only', clientWire: 'json' | 'pb') {
    const host = new SessionHost<Ctx>({ authenticate: (c) => ({ playerId: String(c), name: 'p' }), wire: hostWire, heartbeat: false });
    contract.serve(host, {
        place: (v) => ({ n: v.n + 1, name: `${v.name}!` }),
        legacy: (v) => ({ a: v.a * 2 }),
    });
    const net = network(host);
    const client = new ClientSession({ connect: net.socket, credentials: () => 'ann', wire: clientWire, heartbeat: false, retries: 0 });
    return { host, net, client, calls: contract.client(client) };
}

const kinds = (frames: Frame[]) => frames.map((f) => (typeof f === 'string' ? 'text' : 'binary'));

describe('a session choosing its wire', () => {
    for (const [hostWire, clientWire, spoken] of [
        ['pb', 'pb', 'pb'], ['pb', 'json', 'json'], ['json', 'pb', 'json'], ['json', 'json', 'json'], ['pb-only', 'pb', 'pb'],
    ] as const) {
        it(`host ${hostWire}, client ${clientWire}: speaks ${spoken}, and the contract works`, async () => {
            const { net, client, calls } = session(hostWire, clientWire);
            await client.start();
            net.frames.length = 0;
            expect(await calls.place({ n: 4, name: 'a' })).toEqual({ n: 5, name: 'a!' });
            // a request that is not a proto still works, whatever the wire
            expect(await calls.legacy({ a: 21 })).toEqual({ a: 42 });
            expect(new Set(kinds(net.frames))).toEqual(new Set([spoken === 'pb' ? 'binary' : 'text']));
            client.close();
        });
    }

    it('pushes a proto event, decoded and checked', async () => {
        const { host, client } = session('pb', 'pb');
        const seen: Item[] = [];
        contract.on(client, 'tick', (v) => seen.push(v));
        await client.start();
        contract.push(host as unknown as SessionHost<never>, 'ann', 'tick', { n: 3, name: 'now' });
        await new Promise((r) => setTimeout(r, 5));
        expect(seen).toEqual([{ n: 3, name: 'now' }]);
        client.close();
    });

    it('turns a client away that asks for JSON from a protobuf-only server, for good', async () => {
        const { client } = session('pb-only', 'json');
        await expect(client.start()).rejects.toThrow(/protobuf only/);
    });

    it('runs the contract\'s own check on a request, on either wire', async () => {
        for (const wire of ['json', 'pb'] as const) {
            const { client, calls } = session('pb', wire);
            await client.start();
            await expect(calls.place({ n: 201, name: 'x' })).rejects.toThrow(/n is over 200/);
            client.close();
        }
    });

    it('changes the contract fingerprint when a message\'s shape changes', () => {
        const other = defineContract({ requests: { place: { req: proto({ ...item, shape: 'Item{1:uint32 n}' }), res: proto(item) } } });
        const same = defineContract({ requests: { place: { req: proto(item), res: proto(item) } } });
        const base = defineContract({ requests: { place: { req: proto(item), res: proto(item) } } });
        expect(same.fingerprint).toBe(base.fingerprint);
        expect(other.fingerprint).not.toBe(base.fingerprint);
    });
});
