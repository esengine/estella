// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    recordingClock.ts
 * @brief   The time axis every screen recorder cuts highlights on.
 */
/** Recording time that does not count pauses — the axis both hosts cut clips on. */
export class RecordingClock {
    private startedAt_ = 0;
    private pausedAt_: number | null = null;
    private pausedTotal_ = 0;
    private readonly highlights_: [number, number][] = [];

    constructor(private readonly now_: () => number = Date.now) {}

    start(): void {
        this.startedAt_ = this.now_();
        this.pausedAt_ = null;
        this.pausedTotal_ = 0;
        this.highlights_.length = 0;
    }

    pause(): void {
        if (this.pausedAt_ === null) this.pausedAt_ = this.now_();
    }

    resume(): void {
        if (this.pausedAt_ === null) return;
        this.pausedTotal_ += this.now_() - this.pausedAt_;
        this.pausedAt_ = null;
    }

    elapsedMs(): number {
        const end = this.pausedAt_ ?? this.now_();
        return Math.max(0, end - this.startedAt_ - this.pausedTotal_);
    }

    mark(beforeSeconds: number, afterSeconds: number): void {
        const at = this.elapsedMs();
        this.highlights_.push([Math.max(0, at - beforeSeconds * 1000), at + afterSeconds * 1000]);
    }

    /** Ranges clipped to the recording and merged where they overlap. */
    highlights(durationMs: number): [number, number][] {
        const out: [number, number][] = [];
        const sorted = this.highlights_
            .map(([a, b]): [number, number] => [a, Math.min(b, durationMs)])
            .filter(([a, b]) => b > a)
            .sort((x, y) => x[0] - y[0]);
        for (const r of sorted) {
            const last = out[out.length - 1];
            if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
            else out.push([r[0], r[1]]);
        }
        return out.map(([a, b]) => [Math.round(a), Math.round(b)]);
    }
}
