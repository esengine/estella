// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ProfilerPanel.tsx — the dockable profiler (Unreal Insights analog).
 *
 * The full frame readout lives in a docked panel, not an overlay on the scene.
 * Beyond the live window it captures every frame's full breakdown into a ring, so
 * a hitch is inspectable AFTER the fact (the Insights scrub model, not pausing the
 * app): click any bar in the history graph to freeze + pin that frame and see what
 * cost it that frame; "Pause on hitch" auto-freezes the culprit when it happens.
 */
import { useSyncExternalStore, useRef, useEffect, useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { PerfMonitor } from '@/engine/PerfMonitor';

const BUDGET_MS = 1000 / 60; // 60 Hz frame budget (16.6ms)
const BUDGET_30 = 1000 / 30; // 30 Hz (33.3ms) — the hitch threshold

function kfmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

const cssVar = (el: Element, name: string, fallback: string): string =>
  getComputedStyle(el).getPropertyValue(name).trim() || fallback;

/**
 * Frame-time history — the Insights timeline analog: each recent frame as a bar,
 * 60/30 Hz budgets as reference lines, hitches amber→red, the pinned frame marked.
 * Click a bar to pin it. Canvas (not 240 DOM nodes) so the profiler never janks.
 */
function FrameGraph({ frames, pinnedId }: { frames: number[]; pinnedId: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const accent = cssVar(cv, '--star', '#2f88d6');
    const warn = cssVar(cv, '--warn', '#d3a23c');
    const err = cssVar(cv, '--error', '#d3564b');
    const grid = cssVar(cv, '--text-faint', '#696a71');
    const hi = cssVar(cv, '--text-hi', '#e8e9eb');

    let maxObserved = 0;
    for (const f of frames) if (f > maxObserved) maxObserved = f;
    const maxMs = Math.max(BUDGET_30 * 1.2, maxObserved * 1.1);
    const yOf = (ms: number) => h - (Math.min(ms, maxMs) / maxMs) * h;

    ctx.strokeStyle = grid;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(0, yOf(BUDGET_MS)); ctx.lineTo(w, yOf(BUDGET_MS)); ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, yOf(BUDGET_30)); ctx.lineTo(w, yOf(BUDGET_30)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const n = frames.length;
    if (!n) return;
    const bw = w / n;
    // Index of the pinned frame within the (lockstep) capture ring, for the marker.
    const samples = PerfMonitor.getSamples();
    let pinnedIdx = -1;
    if (pinnedId != null) for (let i = 0; i < samples.length; i++) if (samples[i].id === pinnedId) { pinnedIdx = i; break; }

    for (let i = 0; i < n; i++) {
      const ms = frames[i];
      const y = yOf(ms);
      ctx.fillStyle = ms >= BUDGET_30 ? err : ms >= BUDGET_MS * 1.05 ? warn : accent;
      ctx.fillRect(i * bw, y, Math.max(1, bw - 0.4), h - y);
    }
    if (pinnedIdx >= 0) {
      const x = pinnedIdx * bw + bw / 2;
      ctx.strokeStyle = hi;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }, [frames, pinnedId]);

  const onClick = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    const cv = ref.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const samples = PerfMonitor.getSamples();
    const n = samples.length;
    if (!n) return;
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * n)));
    PerfMonitor.pin(samples[i].id);
  }, []);

  return <canvas ref={ref} className="prof-graph" title="Click a frame to inspect it" onClick={onClick} />;
}

/** One "Frame = a + b + …" bar segment, width ∝ its share of the frame. */
function Seg({ label, ms, frame, color }: { label: string; ms: number; frame: number; color: string }) {
  const pct = frame > 0 ? Math.min(100, (ms / frame) * 100) : 0;
  return (
    <div className="prof-row">
      <span className="prof-key" style={{ color }}>{label}</span>
      <span className="prof-val">{ms.toFixed(1)}<span className="prof-unit">ms</span></span>
      <span className="prof-bar"><span className="prof-fill" style={{ width: `${pct}%`, background: color }} /></span>
    </div>
  );
}

export function ProfilerPanel() {
  const s = useSyncExternalStore(PerfMonitor.subscribe, PerfMonitor.getSnapshot);
  const pinned = s.pinnedId != null ? PerfMonitor.getSample(s.pinnedId) : null;

  // Sections read the pinned frame when one is inspected, else the live window.
  const v = pinned
    ? {
        frameMs: pinned.dt, engineMs: pinned.engineMs, editorMs: pinned.editorMs, gpuMs: pinned.gpuMs,
        drawCalls: pinned.drawCalls, triangles: pinned.triangles, entities: pinned.entities, systems: pinned.systems,
      }
    : {
        frameMs: s.p50, engineMs: s.engineMs, editorMs: s.editorMs, gpuMs: s.gpuMs,
        drawCalls: s.drawCalls, triangles: s.triangles, entities: s.entities, systems: s.systemsTop,
      };
  const frame = Math.max(v.frameMs, v.engineMs + v.editorMs);
  const other = Math.max(0, frame - v.engineMs - v.editorMs);
  const p99Bad = s.p99 >= BUDGET_MS * 1.5;
  // A near-budget frame's leftover is just the browser idle-waiting for vsync — not
  // a hot spot. Only on a spike is the leftover genuinely unattributed work.
  const isIdle = v.frameMs <= BUDGET_MS * 1.25;
  const presentLabel = isIdle ? 'idle' : 'present';

  // Pinned-frame attribution (PP7): the long tasks that hit this frame (the usual
  // cause of an un-instrumented spike) + every measured phase, ranked. `longTaskRev`
  // on the snapshot re-runs this when a task arrives after the frame froze.
  const longTasks = pinned ? PerfMonitor.getFrameLongTasks(pinned.id) : [];
  const measuredMs = pinned ? pinned.engineMs + pinned.editorMs : 0;
  const unattributedMs = pinned ? Math.max(0, pinned.dt - measuredMs) : 0;
  const breakdown: Array<[string, number]> = pinned
    ? [
        ...Object.entries(pinned.editorPhases),
        ...Object.entries(pinned.enginePhases).map(([n, m]) => [`engine.${n}`, m] as [string, number]),
        ...Object.entries(pinned.cppScopes).map(([n, m]) => [`cpp.${n}`, m] as [string, number]),
      ]
        .filter(([, ms]) => ms >= 0.1)
        .sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="prof">
      {/* Capture controls — freeze/live + auto-freeze on hitch. */}
      <div className="prof-controls">
        <button
          type="button"
          className={`prof-btn${s.frozen ? ' on' : ''}`}
          onClick={() => PerfMonitor.toggleFrozen()}
          title={s.frozen ? 'Resume live capture' : 'Freeze capture to inspect frames'}
        >
          {s.frozen ? 'Live' : 'Pause'}
        </button>
        <label className="prof-check">
          <input type="checkbox" checked={s.autoHitch} onChange={(e) => PerfMonitor.setAutoHitch(e.target.checked)} />
          Pause on hitch
        </label>
        <span className="prof-spacer" />
        {pinned ? (
          <span className="prof-pinned">frame #{pinned.id} · {pinned.dt}ms</span>
        ) : (
          <span className="prof-live">live</span>
        )}
      </div>

      {/* Frame timing — history graph + percentiles (live) or the pinned frame. */}
      <section className="prof-sec">
        <h4>Frame</h4>
        <FrameGraph frames={s.frames} pinnedId={s.pinnedId} />
        {pinned ? (
          <div className="prof-budget">
            inspecting frame #{pinned.id} · {pinned.dt}ms
            {pinned.dt >= BUDGET_30 ? <span className="prof-warn"> · hitch</span> : null}
            {' · '}<button type="button" className="prof-link" onClick={() => PerfMonitor.resumeLive()}>back to live</button>
          </div>
        ) : (
          <>
            <div className="prof-stat-grid">
              <div><span>fps</span><b>{s.fps}</b></div>
              <div><span>p50</span><b>{s.p50}<i>ms</i></b></div>
              <div><span>p95</span><b>{s.p95}<i>ms</i></b></div>
              <div><span>p99</span><b style={{ color: p99Bad ? 'var(--warn, #e5a33b)' : undefined }}>{s.p99}<i>ms</i></b></div>
            </div>
            <div className="prof-budget">
              budget {BUDGET_MS.toFixed(1)}ms · {s.longFrames} long frame{s.longFrames === 1 ? '' : 's'}
              {s.worstMs > 0 ? <> · worst {s.worstMs}ms <em>({s.worstPhase ?? 'other'})</em></> : null}
              {s.longTaskMs > 0 ? <span className="prof-warn"> · long task {s.longTaskMs}ms (GC/JS)</span> : null}
            </div>
          </>
        )}
      </section>

      {/* stat unit: Frame = engine (app.run) + editor (gizmo/react) + present/idle.
          GPU is a parallel track (overlaps CPU), shown separately. */}
      <section className="prof-sec">
        <h4>Unit <span className="prof-realm">· {s.realm}</span></h4>
        <Seg label="engine" ms={v.engineMs} frame={frame} color="var(--run, #46a04a)" />
        <Seg label="editor" ms={v.editorMs} frame={frame} color="var(--star, #2f88d6)" />
        <Seg label={presentLabel} ms={other} frame={frame} color="var(--text-mute, #888)" />
        {v.gpuMs >= 0 ? (
          <Seg label="gpu" ms={v.gpuMs} frame={frame} color="#3fb2b2" />
        ) : (
          <div className="prof-row">
            <span className="prof-key">gpu</span>
            <span className="prof-val prof-na">n/a</span>
            <span className="prof-bar" />
          </div>
        )}
      </section>

      {/* Render counters — UE `stat scenerendering` analog. */}
      <section className="prof-sec">
        <h4>Render</h4>
        <div className="prof-stat-grid">
          <div><span>draw calls</span><b>{v.drawCalls}</b></div>
          <div><span>triangles</span><b>{kfmt(v.triangles)}</b></div>
          <div><span>entities</span><b>{v.entities}</b></div>
        </div>
      </section>

      {/* Pinned-frame attribution: the long task that hit it (the usual spike
          cause the phases can't name) + every measured phase, ranked. */}
      {pinned ? (
        <section className="prof-sec">
          <h4>Breakdown · frame #{pinned.id}</h4>
          {longTasks.map((lt, i) => {
            // The dominant same-frame zone that plausibly IS this long task.
            const cause = breakdown.find(([, ms]) => ms >= lt.ms * 0.5);
            return (
              <div className="prof-brk prof-lt" key={`lt${i}`}>
                <span className="prof-brk-name" title={lt.name}>
                  ⚠ long task {cause ? <>→ <b>{cause[0]}</b></> : '· GC / uninstrumented JS'}
                </span>
                <span className="prof-brk-val">{lt.ms}ms</span>
              </div>
            );
          })}
          {breakdown.map(([name, ms]) => (
            <div className="prof-brk" key={name}>
              <span className="prof-brk-name" title={name}>{name}</span>
              <span className="prof-brk-val">{ms.toFixed(1)}ms</span>
            </div>
          ))}
          <div className="prof-budget">
            measured {measuredMs.toFixed(1)}ms of {pinned.dt}ms
            {unattributedMs >= 1 ? (
              <em> · {unattributedMs.toFixed(1)}ms unattributed{longTasks.length ? '' : ' · browser paint / GC'}</em>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Costliest engine systems — windowed max (live) or this frame's actual cost
          (pinned), so a hitch names the system that caused it. UE `stat game`. */}
      <section className="prof-sec">
        <h4>Systems{pinned ? ' · this frame' : ''}</h4>
        {v.systems.length ? (
          <table className="prof-sys">
            <tbody>
              {v.systems.map((sys) => (
                <tr key={sys.name}>
                  <td>{sys.name}</td>
                  <td className="prof-sys-ms">{sys.ms}<i>ms</i></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="prof-empty">No system timings yet.</p>
        )}
      </section>
    </div>
  );
}
