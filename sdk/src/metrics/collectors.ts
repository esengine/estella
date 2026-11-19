// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    collectors.ts
 * @brief   What the SDK's server pieces report, as collectors: a replication
 *          server, a zone, player records, and the process. Each reads totals
 *          the piece already keeps, at scrape time.
 */
import type { ReplicationServer } from '../net/replication/server';
import type { ZoneHost } from '../zones/zoneHost';
import type { PlayerPersistence } from '../persist/players';
import type { MetricCollector, MetricSample } from './registry';

const counter = (name: string, help: string, value: number, labels?: Record<string, string>): MetricSample =>
    ({ name, help, type: 'counter', value, ...(labels ? { labels } : {}) });
const gauge = (name: string, help: string, value: number, labels?: Record<string, string>): MetricSample =>
    ({ name, help, type: 'gauge', value, ...(labels ? { labels } : {}) });

/** Connections, players, how long a replication sample takes, and what the state stream costs. */
export function replicationMetrics(server: ReplicationServer): MetricCollector {
    return () => {
        const clients = server.clientIds.length;
        const present = server.presentIds.length;
        return [
            gauge('replication_connections', 'Open connections, said hello or not.', server.connectionCount),
            gauge('replication_clients', 'Connections past their hello.', clients),
            gauge('replication_players_present', 'Players present: connected, or away within their reconnect grace.', present),
            gauge('replication_players_away', 'Players away within their reconnect grace.', Math.max(0, present - clients)),
            { name: 'replication_sample_ms', help: 'Time one replication sample took, in milliseconds.', type: 'histogram', histogram: server.stats.sampleMs },
            counter('replication_state_frames_total', 'State frames sent, summed over connections.', server.stats.stateFrames),
            counter('replication_state_bytes_total', 'Bytes of state frames sent, summed over connections.', server.stats.stateBytes),
            counter('replication_delta_rows_total', 'Delta rows sent, summed over connections.', server.deltaRowsSent),
            counter('replication_rows_deferred_total', 'Delta rows the bandwidth budget held back.', server.rowsDeferred),
            counter('replication_messages_in_total', 'Game messages received from clients.', server.stats.messagesIn),
            counter('replication_messages_out_total', 'Game messages sent to clients.', server.stats.messagesOut),
            counter('replication_connections_closed_total', 'Connections the server closed, by why.', server.closedFor.abuse, { reason: 'limits' }),
            counter('replication_connections_closed_total', 'Connections the server closed, by why.', server.closedFor.silence, { reason: 'silent' }),
            counter('replication_connections_closed_total', 'Connections the server closed, by why.', server.closedFor.noHello, { reason: 'no_hello' }),
        ];
    };
}

/** A zone's transfers, logins and messages between zones. */
export function zoneMetrics(zone: ZoneHost): MetricCollector {
    return () => {
        const s = zone.stats;
        return [
            gauge('zone_draining', 'Whether the zone is shutting down (1) or not (0).', zone.draining ? 1 : 0),
            counter('zone_transfers_total', 'Transfers out of the zone, by outcome.', s.transfersOut, { outcome: 'sent' }),
            counter('zone_transfers_total', 'Transfers out of the zone, by outcome.', s.transfersFailed, { outcome: 'failed' }),
            counter('zone_logins_total', 'Logins that did not simply stay here, by what happened.', s.loginsRouted, { outcome: 'routed' }),
            counter('zone_logins_total', 'Logins that did not simply stay here, by what happened.', s.onlineElsewhere, { outcome: 'online_elsewhere' }),
            counter('zone_logins_total', 'Logins that did not simply stay here, by what happened.', s.takeOvers, { outcome: 'taken_over' }),
            counter('zone_logins_total', 'Logins that did not simply stay here, by what happened.', s.bounces, { outcome: 'bounced_back' }),
            counter('zone_logins_total', 'Logins that did not simply stay here, by what happened.', s.loginsRefused, { outcome: 'refused' }),
            counter('zone_player_messages_total', 'Messages for players, by what became of them.', s.messagesDelivered, { outcome: 'delivered' }),
            counter('zone_player_messages_total', 'Messages for players, by what became of them.', s.messagesForwarded, { outcome: 'forwarded' }),
            counter('zone_player_messages_total', 'Messages for players, by what became of them.', s.messagesHeld, { outcome: 'held' }),
            counter('zone_player_messages_total', 'Messages for players, by what became of them.', s.messagesDropped, { outcome: 'dropped' }),
        ];
    };
}

/** Player record loads and saves, and the store operations still under way. */
export function playerPersistenceMetrics(players: PlayerPersistence<unknown>): MetricCollector {
    return () => {
        const s = players.stats;
        return [
            gauge('player_records_pending', 'Store operations started and not finished.', players.pendingOperations),
            counter('player_records_total', 'Player record loads and saves, by outcome.', s.loads, { op: 'load', outcome: 'ok' }),
            counter('player_records_total', 'Player record loads and saves, by outcome.', s.loadErrors, { op: 'load', outcome: 'error' }),
            counter('player_records_total', 'Player record loads and saves, by outcome.', s.saves, { op: 'save', outcome: 'ok' }),
            counter('player_records_total', 'Player record loads and saves, by outcome.', s.saveErrors - s.conflicts, { op: 'save', outcome: 'error' }),
            counter('player_records_total', 'Player record loads and saves, by outcome.', s.conflicts, { op: 'save', outcome: 'conflict' }),
        ];
    };
}

interface NodeProcessLike {
    memoryUsage?(): { rss: number; heapUsed: number };
    uptime?(): number;
}
interface EluPerformance {
    eventLoopUtilization?(prev?: unknown): { utilization: number };
}

/**
 * The process: memory, uptime, and how busy the event loop was since the last
 * scrape (0 to 1) — under Node; elsewhere it reports what the runtime has.
 */
export function processMetrics(): MetricCollector {
    const perf = globalThis.performance as unknown as EluPerformance | undefined;
    let lastElu: unknown = perf?.eventLoopUtilization?.();
    return () => {
        const out: MetricSample[] = [];
        const proc = (globalThis as { process?: NodeProcessLike }).process;
        const mem = proc?.memoryUsage?.();
        if (mem) {
            out.push(gauge('process_resident_memory_bytes', 'Resident memory.', mem.rss));
            out.push(gauge('process_heap_used_bytes', 'JavaScript heap in use.', mem.heapUsed));
        }
        if (proc?.uptime) out.push(gauge('process_uptime_seconds', 'Seconds since the process started.', proc.uptime()));
        if (perf?.eventLoopUtilization && lastElu) {
            const now = perf.eventLoopUtilization();
            out.push(gauge('process_event_loop_utilization', 'Share of the time since the last scrape the event loop was busy (0 to 1).',
                perf.eventLoopUtilization(lastElu).utilization));
            lastElu = now;
        }
        return out;
    };
}
