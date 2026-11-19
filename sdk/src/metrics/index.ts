// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   esengine/metrics — what a server process reports about itself: a
 *          registry in the Prometheus text format (and flat JSON), collectors
 *          for the replication server, zones, player records and the process,
 *          the game's own counters, gauges and histograms, and a `/metrics`
 *          request handler.
 */
export {
    MetricsRegistry, metricsHandler,
    type MetricsRegistryOptions, type MetricSample, type MetricCollector, type MetricLabels, type MetricType, type MetricsResponse,
} from './registry';
export { Histogram, MS_BUCKETS } from './histogram';
export { replicationMetrics, zoneMetrics, playerPersistenceMetrics, processMetrics } from './collectors';
