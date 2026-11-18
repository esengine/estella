// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    histogram.ts
 * @brief   A fixed-bucket histogram, cheap enough to observe on a hot path: one
 *          comparison loop over a handful of bounds and two additions. The
 *          buckets are cumulative only when read, as Prometheus wants them.
 */

/** Default bounds, in milliseconds: what a server tick or a sample takes. */
export const MS_BUCKETS: readonly number[] = [0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000];

export class Histogram {
    readonly bounds: readonly number[];
    /** Per bucket, not cumulative; the last one is everything above the top bound. */
    private readonly counts_: number[];
    private sum_ = 0;
    private count_ = 0;

    constructor(bounds: readonly number[] = MS_BUCKETS) {
        this.bounds = [...bounds].sort((a, b) => a - b);
        this.counts_ = new Array(this.bounds.length + 1).fill(0);
    }

    observe(value: number): void {
        let i = 0;
        while (i < this.bounds.length && value > this.bounds[i]!) i++;
        this.counts_[i]!++;
        this.sum_ += value;
        this.count_++;
    }

    get sum(): number { return this.sum_; }
    get count(): number { return this.count_; }

    /** Cumulative counts per bound, then +Inf: what a `_bucket{le=…}` series holds. */
    cumulative(): number[] {
        const out: number[] = [];
        let running = 0;
        for (const c of this.counts_) { running += c; out.push(running); }
        return out;
    }
}
