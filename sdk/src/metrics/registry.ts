// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    registry.ts
 * @brief   What a server process reports about itself, in the text format
 *          Prometheus scrapes (and a flat JSON for anything else). Collectors
 *          are read when the registry is: nothing is computed between scrapes,
 *          so a registry costs a running server nothing until it is asked.
 */
import { Histogram, MS_BUCKETS } from './histogram';

export type MetricLabels = Record<string, string>;
export type MetricType = 'counter' | 'gauge' | 'histogram';

/** One series as a collector reports it. */
export interface MetricSample {
    /** Without the registry's prefix. */
    name: string;
    help: string;
    type: MetricType;
    labels?: MetricLabels;
    /** For a counter or gauge. */
    value?: number;
    /** For a histogram. */
    histogram?: Histogram;
}

/** Reports a set of series; called on every scrape. */
export type MetricCollector = () => MetricSample[];

export interface MetricsRegistryOptions {
    /** Prepended to every name. Default `estella_`. */
    prefix?: string;
    /** On every series: which zone, which host. */
    labels?: MetricLabels;
}

const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

function escapeLabel(v: string): string {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labelText(labels: MetricLabels | undefined, extra?: [string, string]): string {
    const parts = Object.entries(labels ?? {}).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
    if (extra) parts.push(`${extra[0]}="${escapeLabel(extra[1])}"`);
    return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

function num(v: number): string {
    if (Number.isNaN(v)) return 'NaN';
    if (v === Infinity) return '+Inf';
    if (v === -Infinity) return '-Inf';
    return String(v);
}

function key(labels?: MetricLabels): string {
    return JSON.stringify(Object.entries(labels ?? {}).sort());
}

export class MetricsRegistry {
    readonly prefix: string;
    private readonly labels_: MetricLabels;
    private readonly collectors_ = new Set<MetricCollector>();

    constructor(options: MetricsRegistryOptions = {}) {
        this.prefix = options.prefix ?? 'estella_';
        this.labels_ = options.labels ?? {};
    }

    /** Add a collector, read on every scrape. Returns its removal. */
    register(collector: MetricCollector): () => void {
        this.collectors_.add(collector);
        return () => { this.collectors_.delete(collector); };
    }

    /** A counter of the game's own: only goes up. */
    counter(name: string, help: string): { inc(by?: number, labels?: MetricLabels): void } {
        const values = new Map<string, { labels?: MetricLabels; value: number }>();
        this.register(() => [...values.values()].map((v) => ({ name, help, type: 'counter' as const, labels: v.labels, value: v.value })));
        return {
            inc: (by = 1, labels) => {
                const k = key(labels);
                const v = values.get(k) ?? { labels, value: 0 };
                v.value += by;
                values.set(k, v);
            },
        };
    }

    /** A gauge of the game's own: a value now. */
    gauge(name: string, help: string): { set(value: number, labels?: MetricLabels): void } {
        const values = new Map<string, { labels?: MetricLabels; value: number }>();
        this.register(() => [...values.values()].map((v) => ({ name, help, type: 'gauge' as const, labels: v.labels, value: v.value })));
        return { set: (value, labels) => { values.set(key(labels), { labels, value }); } };
    }

    /** A histogram of the game's own (milliseconds by default). */
    histogram(name: string, help: string, bounds: readonly number[] = MS_BUCKETS): { observe(value: number, labels?: MetricLabels): void } {
        const values = new Map<string, { labels?: MetricLabels; h: Histogram }>();
        this.register(() => [...values.values()].map((v) => ({ name, help, type: 'histogram' as const, labels: v.labels, histogram: v.h })));
        return {
            observe: (value, labels) => {
                const k = key(labels);
                let v = values.get(k);
                if (!v) { v = { labels, h: new Histogram(bounds) }; values.set(k, v); }
                v.h.observe(value);
            },
        };
    }

    /** Every series now. */
    collect(): MetricSample[] {
        const out: MetricSample[] = [];
        for (const c of this.collectors_) {
            try { out.push(...c()); } catch { /* one broken collector does not blank the rest */ }
        }
        return out;
    }

    /** The Prometheus text exposition format (version 0.0.4). */
    render(): string {
        const byName = new Map<string, MetricSample[]>();
        for (const s of this.collect()) {
            const full = this.prefix + s.name;
            if (!NAME.test(full)) continue;
            let list = byName.get(full);
            if (!list) { list = []; byName.set(full, list); }
            list.push(s);
        }
        const lines: string[] = [];
        for (const [name, samples] of byName) {
            lines.push(`# HELP ${name} ${samples[0]!.help.replace(/\n/g, ' ')}`);
            lines.push(`# TYPE ${name} ${samples[0]!.type}`);
            for (const s of samples) {
                const labels = { ...this.labels_, ...s.labels };
                if (s.type === 'histogram' && s.histogram) {
                    const h = s.histogram;
                    const cum = h.cumulative();
                    h.bounds.forEach((b, i) => lines.push(`${name}_bucket${labelText(labels, ['le', num(b)])} ${cum[i]}`));
                    lines.push(`${name}_bucket${labelText(labels, ['le', '+Inf'])} ${cum[cum.length - 1]}`);
                    lines.push(`${name}_sum${labelText(labels)} ${num(h.sum)}`);
                    lines.push(`${name}_count${labelText(labels)} ${h.count}`);
                } else {
                    lines.push(`${name}${labelText(labels)} ${num(s.value ?? 0)}`);
                }
            }
        }
        return lines.join('\n') + '\n';
    }

    /**
     * Every series as one flat record, `name{labels}` to a number — a histogram
     * as its `_count`, `_sum` and an estimated `_p50` / `_p99`. For a dashboard
     * of the game's own, a log line, or a test.
     */
    snapshot(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const s of this.collect()) {
            const name = this.prefix + s.name + labelText(s.labels);
            if (s.type === 'histogram' && s.histogram) {
                const h = s.histogram;
                out[`${name}_count`] = h.count;
                out[`${name}_sum`] = h.sum;
                out[`${name}_p50`] = quantileOf(h, 0.5);
                out[`${name}_p99`] = quantileOf(h, 0.99);
            } else {
                out[name] = s.value ?? 0;
            }
        }
        return out;
    }
}

/** The upper bound of the bucket a quantile falls in: what a histogram can say. */
function quantileOf(h: Histogram, q: number): number {
    if (h.count === 0) return 0;
    const cum = h.cumulative();
    const want = q * h.count;
    for (let i = 0; i < h.bounds.length; i++) if (cum[i]! >= want) return h.bounds[i]!;
    return Infinity;
}

/** The part of a Node `http.ServerResponse` the handler uses. */
export interface MetricsResponse {
    writeHead(status: number, headers: Record<string, string>): unknown;
    end(body: string): unknown;
}

/**
 * A request handler that answers with the registry: mount it on the server's
 * own `http` listener (`/metrics`), where Prometheus scrapes it.
 */
export function metricsHandler(registry: MetricsRegistry): (req: unknown, res: MetricsResponse) => void {
    return (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(registry.render());
    };
}
