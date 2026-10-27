// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClientSession, type ClientSessionOptions } from '../src/net/session/ClientSession';
import { SessionHost, SessionRejected, type AcceptedConnection, type SessionContext, type SessionHostOptions } from '../src/net/session/SessionHost';
import { SessionCloseCode } from '../src/net/session/protocol';
import type { PlatformSocket, PlatformSocketEvents } from '../src/platform/types';

type Frame = string | ArrayBuffer;

/** An in-memory network between client sockets and one host, with a way to cut it. */
class FakeNet {
    readonly live = new Set<{ shutdown(code: number, reason: string): void }>();
    readonly serverCloses: number[] = [];
    down = false;
    dials = 0;
    constructor(readonly host: SessionHost<TestCtx>) {}

    socket(): PlatformSocket {
        const events = new Map<string, Set<(...a: never[]) => void>>();
        const emit = <K extends keyof PlatformSocketEvents>(e: K, ...a: PlatformSocketEvents[K]) =>
            events.get(e)?.forEach((f) => (f as (...x: PlatformSocketEvents[K]) => void)(...a));
        const toServer = new Set<(d: Frame) => void>();
        const closeHandlers = new Set<() => void>();
        let open = false;
        const link = {
            shutdown: (code: number, reason: string, byServer = false) => {
                if (!open) return;
                open = false;
                client.readyState = 'closed';
                this.live.delete(link);
                if (byServer) this.serverCloses.push(code);
                queueMicrotask(() => { emit('close', code, reason); closeHandlers.forEach((h) => h()); });
            },
        };
        const client: PlatformSocket = {
            delivery: 'reliable-ordered',
            readyState: 'closed',
            on: (e, h) => {
                let set = events.get(e);
                if (!set) { set = new Set(); events.set(e, set); }
                set.add(h as never);
                return () => set!.delete(h as never);
            },
            connect: () => {
                this.dials++;
                client.readyState = 'connecting';
                queueMicrotask(() => {
                    if (this.down) { client.readyState = 'closed'; emit('error', new Error('refused')); return; }
                    open = true;
                    client.readyState = 'open';
                    this.live.add(link);
                    this.host.accept(conn);
                    emit('open');
                });
            },
            send: (d) => { if (open) queueMicrotask(() => { if (open) toServer.forEach((h) => h(d)); }); },
            close: (code = 1000, reason = '') => link.shutdown(code, reason),
        };
        const conn: AcceptedConnection = {
            transport: {
                send: (d) => { if (open) queueMicrotask(() => { if (open) emit('message', d); }); },
                on: (_e, h) => { toServer.add(h); return () => toServer.delete(h); },
            },
            close: (code = 1000, reason = '') => link.shutdown(code, reason, true),
            onClose: (h) => { closeHandlers.add(h); return () => closeHandlers.delete(h); },
        };
        return client;
    }

    cut(): void {
        for (const l of [...this.live]) l.shutdown(1006, 'cut');
    }
}

interface TestCtx extends SessionContext { name: string }

function setup(hostOpts: Partial<SessionHostOptions<TestCtx>> = {}) {
    const host = new SessionHost<TestCtx>({
        authenticate: (c) => {
            const token = (c as { token?: string })?.token;
            if (token === 'bad') throw new SessionRejected('bad token');
            if (token === 'later') throw new SessionRejected('try again later', false);
            if (!token) throw new SessionRejected('no token');
            return { playerId: token, name: `player-${token}` };
        },
        ...hostOpts,
    });
    const net = new FakeNet(host);
    const client = (token: string, opts: Partial<ClientSessionOptions> = {}) =>
        new ClientSession({
            connect: () => net.socket(),
            credentials: () => ({ token }),
            backoff: { initialMs: 5, maxMs: 20, jitter: 0 },
            retryDelayMs: 5,
            heartbeat: false,
            ...opts,
        });
    return { host, net, client };
}

const closed: ClientSession[] = [];
afterEach(() => { for (const c of closed.splice(0)) c.close(); vi.useRealTimers(); });
const track = (c: ClientSession) => { closed.push(c); return c; };

describe('SessionHost + ClientSession', () => {
    it('says hello, becomes ready, and shares the server clock', async () => {
        const { host, client } = setup();
        const s = track(client('ann'));
        const welcome = await s.start();
        expect(welcome.playerId).toBe('ann');
        expect(s.state).toBe('ready');
        expect(host.playerCount).toBe(1);
        expect(Math.abs(s.serverNow() - Date.now())).toBeLessThan(500);
    });

    it('serves no game request before the hello succeeded', async () => {
        const { host, net } = setup();
        host.handle('secret', () => 'data');
        const { NetChannel } = await import('../src/net/NetChannel');
        const raw = net.socket();
        const channel = new NetChannel(raw);
        raw.connect();
        await vi.waitFor(() => expect(raw.readyState).toBe('open'));
        await expect(channel.request('secret', {})).rejects.toThrow('no request handler');
    });

    it('a fatal refusal stops the session and does not redial', async () => {
        const { net, client } = setup();
        const s = track(client('bad'));
        await expect(s.start()).rejects.toThrow('bad token');
        expect(s.state).toBe('closed');
        const dials = net.dials;
        await new Promise((r) => setTimeout(r, 50));
        expect(net.dials).toBe(dials);
    });

    it('a refusal that is not fatal is retried', async () => {
        const { net, client } = setup();
        const s = track(client('later'));
        void s.start().catch(() => {});
        await vi.waitFor(() => expect(net.dials).toBeGreaterThan(2));
        expect(s.state).not.toBe('closed');
    });

    it('passes the player to handlers, and request answers come back', async () => {
        const { host, client } = setup();
        host.handle<{ n: number }, { who: string; n: number }>('echo', (p, ctx) => ({ who: ctx.name, n: p.n }));
        const s = track(client('bo'));
        await s.start();
        expect(await s.request('echo', { n: 4 })).toEqual({ who: 'player-bo', n: 4 });
    });

    it('a remote error is not retried', async () => {
        const { host, client } = setup();
        let runs = 0;
        host.handle('fail', () => { runs++; throw new Error('no stock'); });
        const s = track(client('cy'));
        await s.start();
        await expect(s.request('fail', {})).rejects.toThrow('no stock');
        expect(runs).toBe(1);
    });

    it('a reply lost with the link is retried under the same key and runs once', async () => {
        const { host, net, client } = setup();
        let runs = 0;
        host.handle('buy', () => {
            runs++;
            net.cut(); // the work is done, the answer never arrives
            return { bought: runs };
        });
        const s = track(client('dee'));
        await s.start();
        const answer = await s.request('buy', {});
        expect(answer).toEqual({ bought: 1 });
        expect(runs).toBe(1);
        expect(net.dials).toBe(2); // the link really dropped and the request really came again
        expect(s.state).toBe('ready');
    });

    it('redials after a cut and keeps its event subscriptions', async () => {
        const { host, net, client } = setup();
        const s = track(client('eve'));
        const heard: unknown[] = [];
        s.on('radio', (m) => heard.push(m));
        await s.start();
        const states: string[] = [];
        s.onState((st) => states.push(st));
        net.cut();
        await vi.waitFor(() => expect(states).toEqual(['reconnecting', 'ready']));
        expect(host.push('eve', 'radio', 'hello again')).toBe(true);
        await vi.waitFor(() => expect(heard).toEqual(['hello again']));
    });

    it('a request issued while the link is down waits for it and then goes through', async () => {
        const { host, net, client } = setup();
        host.handle('ping', () => 'pong');
        const s = track(client('fay'));
        await s.start();
        net.down = true;
        net.cut();
        await vi.waitFor(() => expect(s.state).toBe('reconnecting'));
        const pending = s.request('ping', {});
        await new Promise((r) => setTimeout(r, 30));
        net.down = false;
        expect(await pending).toBe('pong');
    });

    it('a newer connection for the same player replaces the older, which stays closed', async () => {
        const { host, client } = setup();
        const first = track(client('gil'));
        await first.start();
        const second = track(client('gil'));
        await second.start();
        await vi.waitFor(() => expect(first.state).toBe('closed'));
        expect(second.state).toBe('ready');
        expect(host.playerCount).toBe(1);
        await expect(first.request('x', {})).rejects.toThrow('closed');
    });

    it('closes a connection that never says hello', async () => {
        const { net } = setup({ helloTimeoutMs: 20 });
        const raw = net.socket();
        raw.connect();
        await vi.waitFor(() => expect(net.serverCloses).toContain(SessionCloseCode.helloTimeout));
    });

    it('refuses connections past maxSessions', async () => {
        const { net, client } = setup({ maxSessions: 1 });
        const a = track(client('hal'));
        await a.start();
        const raw = net.socket();
        raw.connect();
        await vi.waitFor(() => expect(net.serverCloses).toContain(SessionCloseCode.unavailable));
    });

    it('drops a connection that keeps breaking its limits', async () => {
        const { host, net, client } = setup({ limits: { messagesPerSecond: 1, burst: 1 }, maxViolationsPerMinute: 3 });
        host.handle('noop', () => null);
        const s = track(client('ivy'));
        await s.start();
        for (let i = 0; i < 30; i++) s.send('noop', i);
        await vi.waitFor(() => expect(net.serverCloses).toContain(SessionCloseCode.abuse));
    });

    it('broadcast reaches every player that passes the filter', async () => {
        const { host, client } = setup();
        const a = track(client('a1'));
        const b = track(client('b1'));
        const got: string[] = [];
        a.on('n', () => got.push('a1'));
        b.on('n', () => got.push('b1'));
        await a.start();
        await b.start();
        expect(host.broadcast('n', 1, (ctx) => ctx.playerId === 'b1')).toBe(1);
        await vi.waitFor(() => expect(got).toEqual(['b1']));
    });
});

describe('ClientSession: retry and the reason a link ended', () => {
    it('retryNow dials at once instead of waiting out the backoff, and does nothing when there is nothing to wait for', async () => {
        const { host, net, client } = setup();
        host.handle('ping', () => 'pong');
        const s = track(client('rita', { backoff: { initialMs: 60_000, maxMs: 60_000, jitter: 0 } }));
        await s.start();
        s.retryNow(); // ready: nothing to do
        expect(s.state).toBe('ready');
        net.down = true;
        net.cut();
        await vi.waitFor(() => expect(s.state).toBe('reconnecting'));
        const dials = net.dials;
        net.down = false;
        s.retryNow();
        await vi.waitFor(() => expect(s.state).toBe('ready'));
        expect(net.dials).toBe(dials + 1);
        expect(await s.request('ping', {})).toBe('pong');
        s.close();
        s.retryNow(); // closed: still nothing
        expect(s.state).toBe('closed');
    });

    it('says how the last link ended, and forgets it once connected again', async () => {
        const { net, client } = setup({ maxSessions: 1 });
        const holder = track(client('hal'));
        await holder.start();
        expect(holder.lastClose).toBeNull();
        expect(holder.attempts).toBe(0);

        const full = track(client('fay'));
        void full.start().catch(() => {});
        await vi.waitFor(() => expect(full.lastClose?.code).toBe(SessionCloseCode.unavailable));
        expect(full.attempts).toBeGreaterThan(0);

        holder.close();
        await vi.waitFor(() => expect(full.state).toBe('ready'));
        expect(full.lastClose).toBeNull();
        void net;
    });
});
