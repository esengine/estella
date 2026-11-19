// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  esengine/metrics: what a server process says about itself.
 *
 * The exposition first — every line of a render must parse as the Prometheus
 * text format, or a scraper drops the whole page — then each built-in
 * collector against a real server, zone and record store, checked against
 * what was actually done to them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { clearUserComponents, defineComponent } from '../src/ecs/component';
import { MemoryTransport } from '../src/net/MemoryTransport';
import type { ReliableOrderedTransport } from '../src/net/NetChannel';
import { replicationPlugin, Net, Replicated } from '../src/net/replication';
import { MemoryStore, PlayerPersistence } from '../src/persist';
import { ZoneHost, MemoryBus } from '../src/zones';
import {
    MetricsRegistry, metricsHandler, replicationMetrics, zoneMetrics, playerPersistenceMetrics, processMetrics,
} from '../src/metrics';

const STEP = 1 / 60;
beforeEach(() => clearUserComponents());

/**
 * A strict reader of the text format: HELP and TYPE once per name and before
 * its samples, every sample a known name with well-formed labels and a number.
 */
function parse(text: string): Map<string, number> {
    const out = new Map<string, number>();
    const typed = new Map<string, string>();
    const helped = new Set<string>();
    for (const line of text.split('\n')) {
        if (line === '') continue;
        const meta = /^# (HELP|TYPE) ([a-zA-Z_:][a-zA-Z0-9_:]*) (.*)$/.exec(line);
        if (meta) {
            const [, kind, name, rest] = meta;
            if (kind === 'HELP') { expect(helped.has(name!)).toBe(false); helped.add(name!); }
            else { expect(typed.has(name!)).toBe(false); expect(['counter', 'gauge', 'histogram']).toContain(rest); typed.set(name!, rest!); }
            continue;
        }
        const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(?:[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\]|\\.)*",?)*\})? (-?[0-9.e+]+|\+Inf|-Inf|NaN)$/.exec(line);
        expect(m, `not a sample line: ${line}`).not.toBeNull();
        const base = m![1]!.replace(/_(bucket|sum|count)$/, '');
        expect(typed.has(m![1]!) || typed.get(base) === 'histogram', `no TYPE before ${m![1]}`).toBe(true);
        out.set(m![1]! + (m![2] ?? ''), Number(m![3] === '+Inf' ? Infinity : m![3]));
    }
    return out;
}

describe('MetricsRegistry', () => {
    it('renders counters, gauges and histograms in the Prometheus text format', () => {
        const reg = new MetricsRegistry({ labels: { zone: 'forest#1' } });
        const kills = reg.counter('kills_total', 'Monsters killed.');
        kills.inc();
        kills.inc(2, { kind: 'boss "big"' });
        reg.gauge('weather', 'Weather now.').set(3);
        const h = reg.histogram('loot_ms', 'Loot roll time.', [1, 5]);
        h.observe(0.5); h.observe(3); h.observe(9);
        const text = reg.render();
        const series = parse(text);
        expect(series.get('estella_kills_total{zone="forest#1"}')).toBe(1);
        expect(series.get('estella_kills_total{zone="forest#1",kind="boss \\"big\\""}')).toBe(2);
        expect(series.get('estella_weather{zone="forest#1"}')).toBe(3);
        expect(series.get('estella_loot_ms_bucket{zone="forest#1",le="1"}')).toBe(1);
        expect(series.get('estella_loot_ms_bucket{zone="forest#1",le="5"}')).toBe(2);
        expect(series.get('estella_loot_ms_bucket{zone="forest#1",le="+Inf"}')).toBe(3);
        expect(series.get('estella_loot_ms_count{zone="forest#1"}')).toBe(3);
        expect(series.get('estella_loot_ms_sum{zone="forest#1"}')).toBe(12.5);
        expect(text.match(/# TYPE estella_kills_total/g)).toHaveLength(1);
        const snap = reg.snapshot();
        expect(snap['estella_loot_ms_p50']).toBe(5);
        expect(snap['estella_weather']).toBe(3);
    });

    it('keeps rendering when one collector throws, and answers over a request handler', () => {
        const reg = new MetricsRegistry();
        reg.register(() => { throw new Error('broken'); });
        reg.gauge('ok', 'Still here.').set(1);
        const res = { status: 0, headers: {} as Record<string, string>, body: '' };
        metricsHandler(reg)({}, {
            writeHead: (s: number, h: Record<string, string>) => { res.status = s; res.headers = h; },
            end: (b: string) => { res.body = b; },
        });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain; version=0.0.4');
        expect(parse(res.body).get('estella_ok')).toBe(1);
    });
});

describe('built-in collectors', () => {
    it('report a replication server as it is', async () => {
        const Hp = defineComponent('MetricHp', { hp: 0 }, { replicatedFields: ['hp'] });
        const serverApp = App.new();
        serverApp.addPlugin(replicationPlugin);
        const server = serverApp.getResource(Net).startServer({ authenticate: (c) => ({ playerId: (c as { t: string }).t }) });
        const reg = new MetricsRegistry();
        reg.register(replicationMetrics(server));
        reg.register(processMetrics());
        server.onMessage('hi', () => undefined);

        const app = App.new();
        app.addPlugin(replicationPlugin);
        const [a, b] = MemoryTransport.pair();
        const link = server.attachConnection(a);
        const client = await app.getResource(Net).connect(b, { interpolationDelayTicks: 0, credentials: { t: 'ana' } });
        const e = serverApp.world.spawn('thing');
        serverApp.world.insert(e, Hp, { hp: 1 });
        serverApp.world.insert(e, Replicated, {});
        for (let i = 0; i < 5; i++) {
            serverApp.world.update(e, Hp, (d) => { (d as { hp: number }).hp = i; });
            await serverApp.tick(STEP);
        }
        client.message('hi', 1);
        server.message(client.connectionId, 'yo', 2);
        server.detachConnection(link);

        const s = parse(reg.render());
        expect(s.get('estella_replication_connections')).toBe(0);
        expect(s.get('estella_replication_players_present')).toBe(1);
        expect(s.get('estella_replication_players_away')).toBe(1);
        expect(s.get('estella_replication_sample_ms_count')).toBeGreaterThanOrEqual(4);
        expect(s.get('estella_replication_state_frames_total')).toBeGreaterThanOrEqual(3);
        expect(s.get('estella_replication_state_bytes_total')).toBeGreaterThan(0);
        expect(s.get('estella_replication_messages_in_total')).toBe(1);
        expect(s.get('estella_replication_messages_out_total')).toBe(1);
        expect(s.get('estella_replication_connections_closed_total{reason="limits"}')).toBe(0);
        expect(s.get('estella_process_resident_memory_bytes')).toBeGreaterThan(0);
        expect(s.has('estella_process_event_loop_utilization')).toBe(true);
    });

    it('report a zone and its player records', async () => {
        const store = new MemoryStore();
        const bus = new MemoryBus();
        const mk = async (id: string) => {
            const app = App.new();
            app.addPlugin(replicationPlugin);
            const players = new PlayerPersistence<{ n: number }>({ store, schema: 1, create: () => ({ n: 0 }) });
            const zone = new ZoneHost({ zone: { id, address: `mem://${id}`, kind: 'map' }, store, bus, players: players as PlayerPersistence<unknown>, authenticate: (c) => ({ playerId: (c as { t: string }).t }) });
            const server = app.getResource(Net).startServer({ authenticate: zone.authenticate });
            zone.attach(server);
            await zone.start();
            return { app, zone, server, players };
        };
        const A = await mk('A');
        const B = await mk('B');
        const reg = new MetricsRegistry();
        reg.register(zoneMetrics(A.zone as ZoneHost));
        reg.register(playerPersistenceMetrics(A.players as PlayerPersistence<unknown>));
        const zones: Record<string, typeof A> = { 'mem://A': A, 'mem://B': B };
        const dial = (addr: string): ReliableOrderedTransport => { const [x, y] = MemoryTransport.pair(); zones[addr]!.server.attachConnection(x); return y; };
        const app = App.new();
        app.addPlugin(replicationPlugin);
        const [x, y] = MemoryTransport.pair();
        A.server.attachConnection(x);
        const client = await app.getResource(Net).connect(y, { interpolationDelayTicks: 0, credentials: { t: 'ana' }, dial });
        for (let i = 0; i < 4; i++) { A.zone.tick(); B.zone.tick(); await A.app.tick(STEP); await new Promise((r) => setTimeout(r, 0)); }
        await expect(A.zone.transfer(client.connectionId, 'nowhere')).rejects.toThrow('not up');
        await A.zone.transfer(client.connectionId, 'B');
        await A.zone.sendToPlayer('ana', 'hi', 1);

        const s = parse(reg.render());
        expect(s.get('estella_zone_transfers_total{outcome="sent"}')).toBe(1);
        expect(s.get('estella_zone_transfers_total{outcome="failed"}')).toBe(1);
        expect(s.get('estella_zone_draining')).toBe(0);
        expect(s.get('estella_player_records_total{op="load",outcome="ok"}')).toBe(1);
        expect(s.get('estella_player_records_total{op="save",outcome="ok"}')).toBeGreaterThanOrEqual(1);
    });
});
