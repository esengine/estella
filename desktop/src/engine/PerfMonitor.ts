// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PerfMonitor.ts — the editor's per-frame instrumentation hub.
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

export function sumMs(rec: Record<string, number>): number {
  let s = 0;
  for (const k in rec) s += rec[k];
  return s;
}

export function topSystems(rec: Record<string, number>, n: number): Array<{ name: string; ms: number }> {
  return Object.entries(rec)
    .map(([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, n);
}

/** The engine's last-frame telemetry, supplied by a source callback so PerfMonitor
 *  stays decoupled from the engine host. */
export interface EngineFrame {
  phaseMs: Record<string, number>;
  systemMs: Record<string, number>;
  drawCalls: number;
  triangles: number;
  sprites: number;
  entities: number;
  /** GPU time (ms) via EXT_disjoint_timer_query, or -1 when unavailable. */
  gpuMs: number;
  /** Per-frame C++ CPU scopes (render passes etc.), name → ms — the `cpp.*` rows. */
  cppScopes: Record<string, number>;
  /** Per-frame C++ named counters (culled, cache hits, …). */
  cppCounters: Record<string, number>;
  /** Per-frame per-pass GPU times (submit, postprocess), name → ms. */
  gpuScopes: Record<string, number>;
  /** Total wasm linear memory (bytes) — the engine's heap. */
  wasmBytes: number;
  /** Resident texture VRAM (bytes, estimate). */
  vramBytes: number;
}

/** One frame's full per-frame breakdown, kept in a ring so any past frame can be
 *  inspected after the fact. */
export interface FrameSample {
  id: number;
  dt: number;
  t0: number; // frame window on the performance timeline (for long-task overlap)
  t1: number;
  engineMs: number;
  editorMs: number;
  gpuMs: number;
  editorPhases: Record<string, number>;
  enginePhases: Record<string, number>;
  cppScopes: Record<string, number>;
  gpuScopes: Record<string, number>;
  counters: Record<string, number>;
  systems: Array<{ name: string; ms: number }>;
  drawCalls: number;
  triangles: number;
  entities: number;
}

export interface FrameLongTask {
  ms: number;
  name: string;
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
  engineMs: number;
  editorMs: number;
  drawCalls: number;
  triangles: number;
  entities: number;
  /** Costliest engine systems over the window (name + windowed-max ms). */
  systemsTop: Array<{ name: string; ms: number }>;
  /** Which realm the engine numbers come from. */
  realm: 'edit' | 'play';
  /** GPU time (ms), or -1 when the timer isn't available. */
  gpuMs: number;
  /** Recent frame intervals (ms, oldest→newest) for the history graph. */
  frames: number[];
  frozen: boolean;
  /** The inspected frame's id, or null for the live rolling window. */
  pinnedId: number | null;
  autoHitch: boolean;
  /** Bumps when a long task arrives, so a frozen pinned view refreshes to include it. */
  longTaskRev: number;
  wasmMB: number;
  jsHeapMB: number;
  jsHeapLimitMB: number;
  vramMB: number;
  /** Recent memory samples (oldest→newest) for the memory graph. */
  memHist: Array<{ wasm: number; js: number; vram: number }>;
  /** Latest frame's merged named counters (engine + editor). */
  counters: Record<string, number>;
  /** True while a session is being recorded for export. */
  recording: boolean;
  /** Frames accumulated in the recording buffer. */
  recordedFrames: number;
}

/** A recorded profiling session, serialized to JSON for offline analysis. */
export interface SessionCapture {
  version: number;
  generatedAt: string;
  realm: 'edit' | 'play';
  budgetMs: number;
  frameCount: number;
  frames: FrameSample[];
  /** Recent main-thread long tasks — correlate `start` with frame t0/t1. */
  longTasks?: Array<{ start: number; ms: number; name: string }>;
}

const LONG_FRAME_MS = 24; // missed a 60Hz frame
const HITCH_MS = 50; // auto-freeze threshold — a real hitch (below 20fps)
const WINDOW_MS = 500;
const CAP = 240;
const REC_CAP = 3600; // ~60s of recording, bounded
const r1 = (n: number) => Math.round(n * 10) / 10;

class PerfMonitorImpl {
  private readonly store = createStore<PerfSnapshot>(() => ({
    fps: 0, p50: 0, p95: 0, p99: 0, longFrames: 0, worstMs: 0, worstPhase: null, longTaskMs: 0, visible: false, enabled: true,
    engineMs: 0, editorMs: 0, drawCalls: 0, triangles: 0, entities: 0, systemsTop: [], realm: 'edit', gpuMs: -1, frames: [],
    frozen: false, pinnedId: null, autoHitch: false, longTaskRev: 0,
    wasmMB: 0, jsHeapMB: 0, jsHeapLimitMB: 0, vramMB: 0, memHist: [], counters: {},
    recording: false, recordedFrames: 0,
  }));
  private enabled = true;
  private running = false;
  private raf = 0;
  private obs: PerformanceObserver | null = null;
  private last = 0;
  private windowStart = 0;
  private readonly frames: number[] = [];
  private phase: Record<string, number> = {};
  private frameCounters: Record<string, number> = {};
  private lastCounters: Record<string, number> = {};
  private longFrames = 0;
  private worstMs = 0;
  private worstPhase: string | null = null;
  private longTaskMs = 0;
  private engineSource: (() => EngineFrame | null) | null = null;
  private engineConsumers_ = 0;
  private engineSum = 0;
  private editorSum = 0;
  private winFrames = 0;
  private systemMax: Record<string, number> = {};
  private counters = { drawCalls: 0, triangles: 0, entities: 0, gpuMs: -1 };
  private mem = { wasmBytes: 0, vramBytes: 0 };
  private readonly memHist: Array<{ wasm: number; js: number; vram: number }> = [];
  private realm: 'edit' | 'play' = 'edit';
  private readonly samples: FrameSample[] = [];
  private sampleSeq = 0;
  private frozen = false;
  private autoHitch = false;
  private readonly longTasks: Array<{ start: number; ms: number; name: string }> = [];
  private longTaskRev = 0;
  private recording = false;
  private readonly recordBuffer: FrameSample[] = [];

  start(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.loop);
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this.obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            this.longTaskMs = Math.max(this.longTaskMs, e.duration);
            const attr = (e as PerformanceEntry & { attribution?: Array<{ containerName?: string; name?: string }> }).attribution?.[0];
            this.longTasks.push({ start: e.startTime, ms: e.duration, name: attr?.containerName || attr?.name || e.name || 'self' });
            if (this.longTasks.length > 60) this.longTasks.shift();
          }
          // Bump so a pinned/frozen view refreshes to include the just-arrived task
          // (long tasks are observed a tick after the frame that caused them).
          this.patch({ longTaskRev: ++this.longTaskRev });
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

  /**
   * Register interest in the engine frame — the only expensive per-frame read
   * (cross-boundary counters + CPU/GPU scope JSON marshalling). The loop skips
   * it entirely while nothing is mounted to display it (e.g. the Profiler panel
   * is closed), so an ordinary editing session pays nothing for it. Returns a
   * disposer for the caller's unmount.
   */
  addEngineConsumer(): () => void {
    this.engineConsumers_++;
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.engineConsumers_ = Math.max(0, this.engineConsumers_ - 1);
    };
  }

  /** Freeze the rolling capture and pin a frame for inspection. */
  pin(id: number): void {
    this.frozen = true;
    // Snapshot the static ring's dt into `frames` so the graph holds at this moment.
    this.patch({ frozen: true, pinnedId: id, frames: this.samples.map((s) => s.dt) });
  }

  /** Resume live rolling capture (un-freeze + un-pin). */
  resumeLive(): void {
    this.frozen = false;
    this.patch({ frozen: false, pinnedId: null });
  }

  /** Freeze at the latest captured frame without picking a specific one. */
  freezeLatest(): void {
    const last = this.samples[this.samples.length - 1];
    this.pin(last ? last.id : -1);
  }

  toggleFrozen(): void {
    if (this.store.getState().frozen) this.resumeLive();
    else this.freezeLatest();
  }

  setAutoHitch(on: boolean): void {
    this.autoHitch = on;
    this.patch({ autoHitch: on });
  }

  startRecording(): void {
    this.recordBuffer.length = 0;
    this.recording = true;
    this.patch({ recording: true, recordedFrames: 0 });
  }

  stopRecording(): void {
    this.recording = false;
    this.patch({ recording: false });
  }

  toggleRecording(): void {
    if (this.recording) this.stopRecording(); else this.startRecording();
  }

  /** The recorded session (or the live ring if nothing was recorded), for export. */
  exportSession(): SessionCapture {
    const frames = this.recordBuffer.length ? this.recordBuffer.slice() : this.samples.slice();
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      realm: this.realm,
      budgetMs: 1000 / 60,
      frameCount: frames.length,
      frames,
      longTasks: this.longTasks.slice(),
    };
  }

  /** The capture ring (oldest→newest). Aligned 1:1 with the snapshot's `frames`. */
  getSamples(): readonly FrameSample[] { return this.samples; }

  /** The pinned/queried frame's full breakdown, or null if it scrolled out. */
  getSample(id: number): FrameSample | null {
    for (let i = this.samples.length - 1; i >= 0; i--) if (this.samples[i].id === id) return this.samples[i];
    return null;
  }

  /** Main-thread long tasks (GC / long JS) overlapping a frame's window — usually
   *  the cause of a spike the instrumented phases don't explain. Descending by ms. */
  getFrameLongTasks(id: number): FrameLongTask[] {
    const s = this.getSample(id);
    if (!s) return [];
    return this.longTasks
      .filter((lt) => lt.start < s.t1 && lt.start + lt.ms > s.t0)
      .map((lt) => ({ ms: r1(lt.ms), name: lt.name }))
      .sort((a, b) => b.ms - a.ms);
  }

  /**
   * Wire the per-frame engine telemetry source (edit App or the play iframe).
   * `realm` labels where the numbers come from. Pass null to fold in editor
   * phases only (no engine segment).
   */
  setEngineSource(source: (() => EngineFrame | null) | null, realm: 'edit' | 'play' = 'edit'): void {
    this.engineSource = source;
    this.realm = realm;
  }

  /** Time `fn` as a named frame phase. */
  measure<T>(phase: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.mark(phase, t0);
    }
  }

  /** Record a phase that ran from `startMs` to now. */
  mark(phase: string, startMs: number): void {
    if (!this.enabled) return;
    const end = performance.now();
    this.phase[phase] = (this.phase[phase] ?? 0) + (end - startMs);
    try { performance.measure(`perf:${phase}`, { start: startMs, end }); } catch { /* ignore */ }
  }

  /** Publish a named counter for the current frame (gauge; last write wins). */
  counter(name: string, value: number): void {
    if (this.enabled) this.frameCounters[name] = value;
  }

  /** Report a React commit's duration, attributed to its panel (from a per-panel
   *  <Profiler onRender>). So a panel that stalls a frame (e.g. the Details tree
   *  rebuilding on selection) shows as `react.<id>` instead of the void. */
  reactCommit(id: string, ms: number): void {
    if (this.enabled) {
      const key = `react.${id}`;
      this.phase[key] = (this.phase[key] ?? 0) + ms;
    }
  }

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): PerfSnapshot => this.store.getState();

  private loop = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);

    const prev = this.last;
    this.last = now;
    const editorPhases = this.phase;
    this.phase = {};
    const editorCounters = this.frameCounters;
    this.frameCounters = {};

    // Frozen: hold the capture completely so the pinned frame stays put (the graph
    // and sections read a static ring). First frame: no interval yet.
    if (this.frozen || !prev) return;
    const dt = now - prev;

    this.frames.push(dt);
    if (this.frames.length > CAP) this.frames.shift();
    if (dt >= LONG_FRAME_MS) {
      this.longFrames += 1;
      if (dt > this.worstMs) {
        this.worstMs = dt;
        this.worstPhase = dominantPhase(editorPhases)?.phase ?? 'other';
      }
    }

    if (this.enabled) {
      const editorFrameMs = sumMs(editorPhases);
      this.editorSum += editorFrameMs;
      const ef = (this.engineConsumers_ > 0 || this.recording) ? this.engineSource?.() : null;
      let engineFrameMs = 0;
      let enginePhases: Record<string, number> = {};
      let cppScopes: Record<string, number> = {};
      let gpuScopes: Record<string, number> = {};
      let engineCounters: Record<string, number> = {};
      let systemsFrame: Array<{ name: string; ms: number }> = [];
      if (ef) {
        enginePhases = ef.phaseMs;
        cppScopes = ef.cppScopes;
        gpuScopes = ef.gpuScopes;
        engineCounters = ef.cppCounters;
        engineFrameMs = sumMs(enginePhases);
        this.engineSum += engineFrameMs;
        for (const k in ef.systemMs) {
          if (ef.systemMs[k] > (this.systemMax[k] ?? 0)) this.systemMax[k] = ef.systemMs[k];
        }
        systemsFrame = topSystems(ef.systemMs, 8).map((s) => ({ name: s.name, ms: r1(s.ms) }));
        this.counters = { drawCalls: ef.drawCalls, triangles: ef.triangles, entities: ef.entities, gpuMs: ef.gpuMs };
        this.mem = { wasmBytes: ef.wasmBytes, vramBytes: ef.vramBytes };
      }
      this.winFrames += 1;

      // Capture this frame's full breakdown so it can be inspected later.
      const sample: FrameSample = {
        id: this.sampleSeq++,
        dt: r1(dt),
        t0: prev,
        t1: now,
        engineMs: r1(engineFrameMs),
        editorMs: r1(editorFrameMs),
        gpuMs: this.counters.gpuMs >= 0 ? r1(this.counters.gpuMs) : -1,
        editorPhases: { ...editorPhases },
        enginePhases: { ...enginePhases },
        cppScopes: { ...cppScopes },
        gpuScopes: { ...gpuScopes },
        counters: { ...engineCounters, ...editorCounters },
        systems: systemsFrame,
        drawCalls: this.counters.drawCalls,
        triangles: this.counters.triangles,
        entities: this.counters.entities,
      };
      this.lastCounters = sample.counters;
      this.samples.push(sample);
      if (this.samples.length > CAP) this.samples.shift();
      if (this.recording) {
        this.recordBuffer.push(sample);
        if (this.recordBuffer.length > REC_CAP) this.recordBuffer.shift();
      }

      // A hitch catches itself: freeze + pin so the culprit is right there.
      if (this.autoHitch && dt >= HITCH_MS) {
        this.pin(sample.id);
        return;
      }
    }

    if (this.windowStart === 0) this.windowStart = now;
    if (now - this.windowStart >= WINDOW_MS) {
      const p50 = percentile(this.frames, 50);
      const wf = this.winFrames || 1;
      const MB = 1 / (1024 * 1024);
      const jsMem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      const wasmMB = r1(this.mem.wasmBytes * MB);
      const vramMB = r1(this.mem.vramBytes * MB);
      const jsHeapMB = jsMem ? r1(jsMem.usedJSHeapSize * MB) : 0;
      const jsHeapLimitMB = jsMem ? Math.round(jsMem.jsHeapSizeLimit * MB) : 0;
      this.memHist.push({ wasm: wasmMB, js: jsHeapMB, vram: vramMB });
      if (this.memHist.length > CAP) this.memHist.shift();
      this.patch({
        fps: p50 > 0 ? Math.round(1000 / p50) : 0,
        p50: r1(p50), p95: r1(percentile(this.frames, 95)), p99: r1(percentile(this.frames, 99)),
        longFrames: this.longFrames, worstMs: r1(this.worstMs), worstPhase: this.worstPhase, longTaskMs: r1(this.longTaskMs),
        engineMs: r1(this.engineSum / wf), editorMs: r1(this.editorSum / wf),
        drawCalls: this.counters.drawCalls, triangles: this.counters.triangles, entities: this.counters.entities,
        systemsTop: topSystems(this.systemMax, 5).map((s) => ({ name: s.name, ms: r1(s.ms) })),
        realm: this.realm,
        gpuMs: this.counters.gpuMs >= 0 ? r1(this.counters.gpuMs) : -1,
        frames: this.samples.map((s) => s.dt),
        wasmMB, jsHeapMB, jsHeapLimitMB, vramMB, memHist: this.memHist.slice(),
        counters: this.lastCounters,
        recordedFrames: this.recordBuffer.length,
      });
      this.windowStart = now;
      this.longFrames = 0; this.worstMs = 0; this.worstPhase = null; this.longTaskMs = 0;
      this.engineSum = 0; this.editorSum = 0; this.winFrames = 0; this.systemMax = {};
    }
  };

  private patch(p: Partial<PerfSnapshot>): void {
    this.store.setState({ ...this.store.getState(), ...p });
  }
}

export const PerfMonitor = new PerfMonitorImpl();
