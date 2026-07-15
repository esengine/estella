// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A boot-phase profiler for the "open project → engine ready" path. The
 *        editor shows a "Booting esengine…" overlay until EngineHost flips to
 *        'ready', and that flip only happens after the wasm instantiates AND the
 *        scene bootstrap (which runs a full project-wide asset scan) completes.
 *        Nothing measured where the seconds actually go — this does.
 *
 *        Renderer-side aggregator: it times renderer phases directly and folds in
 *        main-process costs as they are experienced (IPC round-trips) plus any
 *        sub-phase breakdown a handler chooses to return (see `detail`). One
 *        console.table per open, and `window.__estellaBootProfile` for tooling.
 */

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface BootPhase {
  name: string;
  ms: number;
  /** Optional sub-phase breakdown, e.g. a main-process scan's adopt/walk/deps split. */
  detail?: Record<string, number>;
}

export interface BootProfile {
  label: string;
  total: number;
  phases: BootPhase[];
}

class BootProfiler {
  private active = false;
  private t0 = 0;
  private label = '';
  private phases: BootPhase[] = [];
  // Detail can be reported from INSIDE a phase's fn — before phase() has recorded
  // the phase — so buffer it by name and attach when the phase lands.
  private pendingDetails = new Map<string, Record<string, number>>();

  private lastMarkAt = 0;

  /** Open a fresh profile. A second begin() before report() discards the first. */
  begin(label: string): void {
    this.active = true;
    this.label = label;
    this.t0 = now();
    this.lastMarkAt = 0;
    this.phases = [];
    this.pendingDetails.clear();
  }

  /**
   * Record an event boundary — the phase is the gap since the previous mark (or
   * begin). For event-driven sequences (e.g. Play: prepare → iframe hello →
   * ready) where phase() can't wrap a single awaited call.
   */
  mark(name: string): void {
    if (!this.active) return;
    const at = now() - this.t0;
    const phase: BootPhase = { name, ms: round1(at - this.lastMarkAt) };
    const pending = this.pendingDetails.get(name);
    if (pending) { phase.detail = pending; this.pendingDetails.delete(name); }
    this.phases.push(phase);
    this.lastMarkAt = at;
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Time one async phase and record it. A no-op wrapper (just awaits `fn`) when
   * no profile is open, so instrumented functions on the shared open→ready path
   * are safe to call outside a boot (e.g. re-opening a scene while running).
   */
  async phase<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    if (!this.active) return fn();
    const start = now();
    try {
      return await fn();
    } finally {
      const phase: BootPhase = { name, ms: round1(now() - start) };
      const pending = this.pendingDetails.get(name);
      if (pending) { phase.detail = pending; this.pendingDetails.delete(name); }
      this.phases.push(phase);
    }
  }

  /**
   * Attach a sub-phase breakdown to the phase named `name` — usable from inside
   * that phase's fn (buffered until the phase lands) or after it (attached to the
   * already-recorded phase).
   */
  detail(name: string, detail: Record<string, number>): void {
    if (!this.active) return;
    for (let i = this.phases.length - 1; i >= 0; i--) {
      if (this.phases[i].name === name) { this.phases[i].detail = detail; return; }
    }
    this.pendingDetails.set(name, detail);
  }

  /** Close the profile: emit one table + a summary line, and publish the data. */
  report(): BootProfile | null {
    if (!this.active) return null;
    this.active = false;
    const total = round1(now() - this.t0);
    const measured = this.phases.reduce((s, p) => s + p.ms, 0);
    const other = round1(total - measured);

    const rows = this.phases
      .slice()
      .sort((a, b) => b.ms - a.ms)
      .map((p) => ({ phase: p.name, ms: p.ms, '%': total > 0 ? Math.round((p.ms / total) * 100) : 0 }));
    if (other > 0.5) rows.push({ phase: '(other/setup)', ms: other, '%': total > 0 ? Math.round((other / total) * 100) : 0 });

    const profile: BootProfile = { label: this.label, total, phases: this.phases.slice() };
    // One compact table + a one-liner. The table is the "直观数据统计"; the
    // window handle lets automation/SHOT scripts read the profile programmatically.
    /* eslint-disable no-console */
    console.info(`[boot] ${this.label}: ${total}ms total (slowest: ${rows[0]?.phase} ${rows[0]?.ms}ms)`);
    console.table(rows);
    for (const p of this.phases) {
      if (p.detail) console.info(`[boot]   ${p.name} breakdown:`, p.detail);
    }
    /* eslint-enable no-console */
    (window as unknown as { __estellaBootProfile?: BootProfile }).__estellaBootProfile = profile;
    return profile;
  }
}

/** Shared singleton — the open→ready path is a single sequence, so one profile at a time. */
export const bootProfiler = new BootProfiler();
