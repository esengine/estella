// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    subsystems.ts
 * @brief   Per-App registry of engine subsystem lifecycle + liveness — the
 *          observability seam for "which modules are loaded, ready, stepping, or
 *          errored".
 *
 * @details Phase (registered → initializing → ready, error terminal) is recorded;
 *          each transition appends a timestamped event for history. Liveness is
 *          derived, not stored: an owned system pets the watchdog via
 *          markStepped() each tick; getStatuses() reports `stepping` while beats
 *          are fresh, `idle` once stale (e.g. physics frozen by playModeOnly in
 *          edit mode) — the load≠run distinction. One registry per realm, never a
 *          shared singleton, so realms report independently.
 */

/** Wall clock for beat/age math; degrades to 0 where performance is absent. */
function nowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : 0;
}

/** Beats older than this (ms) read as stopped — bridges a ~33ms fixed step +
 *  editor sampling, yet flips to `idle` promptly on pause. */
const STEP_STALE_MS = 400;

/** Bound on retained lifecycle events (a diagnostics tail, not full history). */
const EVENT_LOG_CAP = 128;

/** Recorded lifecycle phases. `stepping` / `idle` are derived, not phases. */
export type SubsystemPhase = 'registered' | 'initializing' | 'ready' | 'error';

/** Runtime liveness, derived from watchdog beats at read time. */
export type SubsystemActivity = 'stepping' | 'idle' | 'inactive';

/** One recorded lifecycle transition. */
export interface SubsystemEvent {
    readonly id: string;
    readonly phase: SubsystemPhase;
    readonly detail?: string;
    /** performance.now() at emit, for ordering and age. */
    readonly atMs: number;
    /** Monotonic emit counter — stable order even across equal timestamps. */
    readonly seq: number;
}

/** A subsystem's current status, with liveness derived at read time. */
export interface SubsystemStatus {
    readonly id: string;
    readonly displayName: string;
    readonly phase: SubsystemPhase;
    readonly activity: SubsystemActivity;
    /** Latest phase detail (e.g. an error message). */
    readonly detail?: string;
    /** The last error reason, retained even after later transitions. */
    readonly lastError?: string;
    /** Plugin names this subsystem declared a dependency on (cascade context). */
    readonly dependsOn: readonly string[];
    /** How long the current phase has been held, in ms. */
    readonly phaseAgeMs: number;
}

interface Entry {
    id: string;
    displayName: string;
    phase: SubsystemPhase;
    detail?: string;
    lastError?: string;
    dependsOn: string[];
    phaseSinceMs: number;
    lastBeatMs: number;
}

export class SubsystemRegistry {
    private readonly entries_ = new Map<string, Entry>();
    /** Insertion order, so the UI lists subsystems install-order stably. */
    private readonly order_: string[] = [];
    private readonly events_: SubsystemEvent[] = [];
    private readonly listeners_ = new Set<() => void>();
    private seq_ = 0;

    /** Register (or re-register) a subsystem in the `registered` phase. */
    register(id: string, opts: { displayName?: string; dependsOn?: string[] } = {}): void {
        let e = this.entries_.get(id);
        if (!e) {
            e = {
                id,
                displayName: opts.displayName ?? id,
                phase: 'registered',
                dependsOn: opts.dependsOn ?? [],
                phaseSinceMs: nowMs(),
                lastBeatMs: 0,
            };
            this.entries_.set(id, e);
            this.order_.push(id);
        } else {
            if (opts.displayName) e.displayName = opts.displayName;
            if (opts.dependsOn) e.dependsOn = opts.dependsOn;
            e.phase = 'registered';
            e.phaseSinceMs = nowMs();
            e.lastError = undefined;
        }
        this.emit_(id, 'registered');
    }

    /** Move a subsystem to a new lifecycle phase (no-op for an unknown id). */
    transition(id: string, phase: SubsystemPhase, detail?: string): void {
        const e = this.entries_.get(id);
        if (!e) return;
        e.phase = phase;
        e.detail = detail;
        e.phaseSinceMs = nowMs();
        if (phase === 'error') e.lastError = detail ?? e.lastError;
        this.emit_(id, phase, detail);
    }

    /** Terminal error transition; keeps the reason in `lastError`. */
    markError(id: string, reason?: string): void {
        this.transition(id, 'error', reason);
    }

    /** The current phase of a subsystem, or undefined if unknown. */
    phaseOf(id: string): SubsystemPhase | undefined {
        return this.entries_.get(id)?.phase;
    }

    /** Pet the watchdog: an owned system ran this frame. Cheap and silent (no
     *  notify) — liveness is sampled, not pushed. Call once per tick. */
    markStepped(id: string): void {
        const e = this.entries_.get(id);
        if (e) e.lastBeatMs = nowMs();
    }

    /** Current status of every subsystem, install order, liveness derived now. */
    getStatuses(): SubsystemStatus[] {
        const t = nowMs();
        return this.order_.map((id) => {
            const e = this.entries_.get(id)!;
            // Never-beat → `inactive` (liveness unknown), not a misleading `idle`.
            let activity: SubsystemActivity = 'inactive';
            if (e.phase === 'ready' && e.lastBeatMs > 0) {
                activity = t - e.lastBeatMs <= STEP_STALE_MS ? 'stepping' : 'idle';
            }
            return {
                id: e.id,
                displayName: e.displayName,
                phase: e.phase,
                activity,
                detail: e.detail,
                lastError: e.lastError,
                dependsOn: e.dependsOn.slice(),
                phaseAgeMs: t - e.phaseSinceMs,
            };
        });
    }

    /** Recent lifecycle transitions, oldest→newest (for a diagnostics log). */
    recentEvents(limit = EVENT_LOG_CAP): SubsystemEvent[] {
        return limit >= this.events_.length ? this.events_.slice() : this.events_.slice(-limit);
    }

    /** Subscribe to phase transitions (not per-beat). Returns an unsubscribe. */
    subscribe(fn: () => void): () => void {
        this.listeners_.add(fn);
        return () => {
            this.listeners_.delete(fn);
        };
    }

    private emit_(id: string, phase: SubsystemPhase, detail?: string): void {
        this.events_.push({ id, phase, detail, atMs: nowMs(), seq: ++this.seq_ });
        if (this.events_.length > EVENT_LOG_CAP) this.events_.shift();
        for (const fn of this.listeners_) fn();
    }
}
