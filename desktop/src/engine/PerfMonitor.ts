// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PerfMonitor.ts — the editor's frame instrumentation.
 *
 * One place every per-frame phase reports into, so viewport jank is an
 * ATTRIBUTED measurement, not a guess:
 *  - measure(phase, fn) / mark(phase, t0) time a phase, accumulate it per frame,
 *    and emit a User Timing measure (labeled tracks in the DevTools Performance
 *    panel).
 *  - a rAF samples the real frame interval → p50/p95/p99 + dropped-frame count,
 *    and attributes each long frame to its dominant phase.
 *  - a PerformanceObserver surfaces main-thread long tasks (GC / long JS).
 * Near-free when disabled (the timers short-circuit). Drives the Perf overlay.
 */
import { createStore } from 'zustand/vanilla';

/** p-th percentile (0..100) of an unsorted sample; 0 for an empty set. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}

/** The phase with the most accumulated time in a frame, or null. */
export function dominantPhase(phases: Record<string, number>): { phase: string; ms: number } | null {
  let best: { phase: string; ms: number } | null = null;
  for (const phase in phases) {
    const ms = phases[phase];
    if (!best || ms > best.ms) best = { phase, ms };
  }
  return best;
}

export interface PerfSnapshot {
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  /** Frames over the long-frame budget in the last window. */
  longFrames: number;
  worstMs: number;
  worstPhase: string | null;
  /** Longest main-thread task (ms) seen in the window (GC / long JS). */
  longTaskMs: number;
  visible: boolean;
  enabled: boolean;
}

const LONG_FRAME_MS = 24; // missed a 60Hz frame
const WINDOW_MS = 500;
const CAP = 240;
const r1 = (n: number) => Math.round(n * 10) / 10;

class PerfMonitorImpl {
  private readonly store = createStore<PerfSnapshot>(() => ({
    fps: 0, p50: 0, p95: 0, p99: 0, longFrames: 0, worstMs: 0, worstPhase: null, longTaskMs: 0, visible: false, enabled: true,
  }));
  private enabled = true;
  private running = false;
  private raf = 0;
  private obs: PerformanceObserver | null = null;
  private last = 0;
  private windowStart = 0;
  private readonly frames: number[] = [];
  private phase: Record<string, number> = {};
  private longFrames = 0;
  private worstMs = 0;
  private worstPhase: string | null = null;
  private longTaskMs = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.loop);
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this.obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) this.longTaskMs = Math.max(this.longTaskMs, e.duration);
        });
        this.obs.observe({ entryTypes: ['longtask'] });
      } catch { /* longtask unsupported — frame timing still works */ }
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.obs?.disconnect();
    this.obs = null;
  }

  setEnabled(on: boolean): void { this.enabled = on; this.patch({ enabled: on }); }
  toggleOverlay(): void { this.patch({ visible: !this.store.getState().visible }); }

  /** Time `fn` as a named frame phase (accumulates + emits a User Timing measure). */
  measure<T>(phase: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.mark(phase, t0);
    }
  }

  /** Record a phase that ran from `startMs` to now (accumulate + User Timing). */
  mark(phase: string, startMs: number): void {
    if (!this.enabled) return;
    const end = performance.now();
    this.phase[phase] = (this.phase[phase] ?? 0) + (end - startMs);
    try { performance.measure(`perf:${phase}`, { start: startMs, end }); } catch { /* ignore */ }
  }

  /** Report a React commit's duration (from a <Profiler onRender>). */
  reactCommit(ms: number): void {
    if (this.enabled) this.phase['react.commit'] = (this.phase['react.commit'] ?? 0) + ms;
  }

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): PerfSnapshot => this.store.getState();

  private loop = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    if (this.last) {
      const dt = now - this.last;
      this.frames.push(dt);
      if (this.frames.length > CAP) this.frames.shift();
      if (dt >= LONG_FRAME_MS) {
        this.longFrames += 1;
        if (dt > this.worstMs) {
          this.worstMs = dt;
          this.worstPhase = dominantPhase(this.phase)?.phase ?? 'other';
        }
      }
    }
    this.phase = {};
    this.last = now;

    if (this.windowStart === 0) this.windowStart = now;
    if (now - this.windowStart >= WINDOW_MS) {
      const p50 = percentile(this.frames, 50);
      this.patch({
        fps: p50 > 0 ? Math.round(1000 / p50) : 0,
        p50: r1(p50), p95: r1(percentile(this.frames, 95)), p99: r1(percentile(this.frames, 99)),
        longFrames: this.longFrames, worstMs: r1(this.worstMs), worstPhase: this.worstPhase, longTaskMs: r1(this.longTaskMs),
      });
      this.windowStart = now;
      this.longFrames = 0; this.worstMs = 0; this.worstPhase = null; this.longTaskMs = 0;
    }
  };

  private patch(p: Partial<PerfSnapshot>): void {
    this.store.setState({ ...this.store.getState(), ...p });
  }
}

export const PerfMonitor = new PerfMonitorImpl();
