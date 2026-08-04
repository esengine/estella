// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Diagnostics.ts
 * @brief   What went wrong in a shipped game, aggregated — and deliberately
 *          not sent anywhere the game did not ask for.
 *
 * THE ENGINE NEVER PICKS A DESTINATION. There is no default endpoint, no
 * bundled vendor, and nothing here opens a socket. A game engine that phoned
 * home by default would be shipping every one of its users' players into a
 * decision their developer never made, and "it is only error text" is not a
 * defence — stacks carry file paths, messages carry whatever was interpolated
 * into them. So the sink is a function the GAME installs, and with none
 * installed this still does its whole job locally: events aggregate, the
 * counters are readable, and a debug overlay can show them. Nothing leaves.
 *
 * What it collects is what the engine already knew and dropped on the floor:
 * every `log.error` (see DiagnosticsPlugin — the logger has been a broadcast
 * for a long time, it just had no listener that outlived the console), plus the
 * three failures that never reach a log because they happen outside the frame —
 * unhandled host errors, a lost GL context, and OS memory pressure.
 *
 * Two properties make it safe to leave on:
 *
 *   It cannot flood. Occurrences of one problem collapse into one event with a
 *   count (see events.ts), and the number of DISTINCT events is capped.
 *
 *   It cannot become the crash. A sink that throws is caught, and — the part
 *   that is easy to miss — its failure is NOT logged, because this listens to
 *   the log and would report its own report forever.
 */
import { defineResource } from '../ecs/resource';
import {
    fingerprint, messageOf, stackOf,
    type DiagnosticEvent, type DiagnosticReport,
} from './events';

/**
 * Where a game sends its diagnostics. Receives DISTINCT events with counts, not
 * individual occurrences.
 *
 * Called on the game's own thread with whatever has accumulated. It must not
 * throw — one that does is caught and dropped — and it should not block: a sink
 * that awaits a network round-trip inside the frame has traded a bug report for
 * a stutter. Batch and send it yourself.
 */
export type DiagnosticsSink = (events: readonly DiagnosticEvent[]) => void;

export interface DiagnosticsOptions {
    /**
     * How many distinct problems to track at once. Reached, further NEW problems
     * are dropped (counted in {@link DiagnosticsAPI.dropped}) while the ones
     * already known keep counting.
     *
     * Keeping the earliest rather than the newest is deliberate: when a game
     * comes apart it comes apart in cascade, and the first distinct failure is
     * the one that explains the next fifty. An LRU here would evict the cause
     * and keep the consequences.
     */
    maxDistinct?: number;
    /** Seconds between handing what has accumulated to the sink. Zero delivers
     *  on the next frame, which is rarely what a network sink wants. */
    flushIntervalSec?: number;
}

const DEFAULTS = { maxDistinct: 64, flushIntervalSec: 10 };

export class DiagnosticsAPI {
    private events_ = new Map<string, DiagnosticEvent>();
    private sink_: DiagnosticsSink | null = null;
    private maxDistinct_: number;
    private flushInterval_: number;
    private sinceFlush_ = 0;
    private dropped_ = 0;
    /** Re-entrancy guard — see the file header. Set while a sink runs, so
     *  anything reported from inside it (or from the logger it touched) is
     *  ignored instead of recursing. */
    private inSink_ = false;

    constructor(options: DiagnosticsOptions = {}) {
        this.maxDistinct_ = Math.max(1, options.maxDistinct ?? DEFAULTS.maxDistinct);
        this.flushInterval_ = Math.max(0, options.flushIntervalSec ?? DEFAULTS.flushIntervalSec);
    }

    /**
     * Install where diagnostics go, or `null` to stop sending (events still
     * aggregate locally). Installing a sink hands it whatever has already
     * accumulated — a game that installs one after boot does not lose the boot.
     */
    setSink(sink: DiagnosticsSink | null): void {
        this.sink_ = sink;
        if (sink && this.events_.size > 0) this.flush();
    }

    /** Report a problem. Repeats of one already seen increment its count. */
    report(report: DiagnosticReport): void {
        if (this.inSink_) return;
        const id = fingerprint(report);
        const now = Date.now();
        const existing = this.events_.get(id);
        if (existing) {
            existing.count++;
            existing.lastAt = now;
            // The newest context wins: for a repeating failure, the state it is
            // in NOW is the one someone will try to reproduce.
            if (report.context) existing.context = report.context;
            return;
        }
        if (this.events_.size >= this.maxDistinct_) {
            this.dropped_++;
            return;
        }
        const event: DiagnosticEvent = {
            kind: report.kind,
            id,
            message: report.message,
            count: 1,
            firstAt: now,
            lastAt: now,
        };
        if (report.source) event.source = report.source;
        const stack = stackOf(report.error);
        if (stack) event.stack = stack;
        if (report.context) event.context = report.context;
        this.events_.set(id, event);
    }

    /** Report something thrown, taking the message and stack off it. */
    reportError(kind: DiagnosticReport['kind'], error: unknown, source?: string): void {
        this.report({ kind, message: messageOf(error), error, source });
    }

    /** The distinct problems seen since the last flush, oldest first. */
    get events(): readonly DiagnosticEvent[] {
        return [...this.events_.values()];
    }

    /** New problems that were not tracked because {@link DiagnosticsOptions.maxDistinct}
     *  was reached. A non-zero value here means the report is incomplete, and a
     *  sink should say so rather than let it read as the whole picture. */
    get dropped(): number {
        return this.dropped_;
    }

    /**
     * Hand everything accumulated to the sink and start a new window.
     *
     * Clears even when there is no sink: the alternative is a game that never
     * installs one accumulating counts forever, and a count since boot is not
     * what the API promises. What survives with no sink is the aggregation, not
     * an unbounded history.
     */
    flush(): void {
        this.sinceFlush_ = 0;
        if (this.events_.size === 0) return;
        const batch = [...this.events_.values()];
        this.events_.clear();
        this.dropped_ = 0;
        const sink = this.sink_;
        if (!sink) return;
        this.inSink_ = true;
        try {
            sink(batch);
        } catch {
            // A failing sink is not a reason to fail a frame, and reporting it
            // would be reporting into the thing that just broke.
        } finally {
            this.inSink_ = false;
        }
    }

    /** Advance the flush clock. Driven by the plugin's system, not a timer —
     *  a background tab or a suspended mini-game should not be flushing. */
    tick(deltaSeconds: number): void {
        if (this.events_.size === 0) return;
        this.sinceFlush_ += deltaSeconds;
        if (this.sinceFlush_ >= this.flushInterval_) this.flush();
    }

    /** Drop everything without sending. */
    clear(): void {
        this.events_.clear();
        this.dropped_ = 0;
        this.sinceFlush_ = 0;
    }
}

export const Diagnostics = defineResource<DiagnosticsAPI>(null!, 'Diagnostics');
