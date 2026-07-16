// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ProfilerPanel.tsx — the dockable profiler panel.
 */
import { useSyncExternalStore, useRef, useEffect, useCallback, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { PerfMonitor } from '@/engine/PerfMonitor';
import { t } from '@/i18n';

const BUDGET_MS = 1000 / 60; // 60 Hz frame budget (16.6ms)
const BUDGET_30 = 1000 / 30; // 30 Hz (33.3ms) — the hitch threshold

// GPU/VRAM metric identity — the --vram token (canvas draws read it at paint
// time via cssVar; this is the same-value fallback).
const GPU_FALLBACK = '#3fb2b2';
const GPU_COLOR = `var(--vram, ${GPU_FALLBACK})`;

function kfmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

const cssVar = (el: Element, name: string, fallback: string): string =>
  getComputedStyle(el).getPropertyValue(name).trim() || fallback;

function downloadSession(): void {
  const cap = PerfMonitor.exportSession();
  const blob = new Blob([JSON.stringify(cap)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `profile-${cap.generatedAt.replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const GROUPS = [
  { id: 'frame', label: t('prof.groupFrame') },
  { id: 'unit', label: t('prof.groupUnit') },
  { id: 'render', label: t('prof.groupRender') },
  { id: 'counters', label: t('prof.groupCounters') },
  { id: 'memory', label: t('prof.groupMemory') },
  { id: 'systems', label: t('prof.groupSystems') },
] as const;
const GROUPS_KEY = 'estella.profiler.hiddenGroups';

function useHiddenGroups(): [Set<string>, (id: string) => void] {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const toggle = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(GROUPS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);
  return [hidden, toggle];
}

/** Memory over time — wasm heap / JS heap / texture VRAM as autoscaled lines. */
function MemGraph({ hist }: { hist: Array<{ wasm: number; js: number; vram: number }> }) {
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
    const n = hist.length;
    if (!n) return;
    let max = 1;
    for (const m of hist) max = Math.max(max, m.wasm, m.js, m.vram);
    const colors = { wasm: cssVar(cv, '--warn', '#d3a23c'), js: cssVar(cv, '--star', '#2f88d6'), vram: cssVar(cv, '--vram', GPU_FALLBACK) };
    const line = (key: 'wasm' | 'js' | 'vram') => {
      ctx.strokeStyle = colors[key];
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1 || 1)) * w;
        const y = h - (hist[i][key] / max) * h;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    line('wasm');
    line('vram');
    line('js');
  }, [hist]);
  return <canvas ref={ref} className="prof-graph" />;
}

/** Frame-time history: each recent frame as a bar with 60/30 Hz budget lines,
 *  hitches amber→red, the pinned frame marked. Click a bar to pin it. */
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
    const err = cssVar(cv, '--error', '#d65a5a');
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

  return <canvas ref={ref} className="prof-graph" title={t('prof.clickToInspect')} onClick={onClick} />;
}

/** One "Frame = a + b + …" bar segment, width ∝ its share of the frame. */
function Seg({ label, ms, frame, color, title }: { label: string; ms: number; frame: number; color: string; title?: string }) {
  const pct = frame > 0 ? Math.min(100, (ms / frame) * 100) : 0;
  return (
    <div className="prof-row" title={title}>
      <span className="prof-key" style={{ color }}>{label}</span>
      <span className="prof-val">{ms.toFixed(1)}<span className="prof-unit">ms</span></span>
      <span className="prof-bar"><span className="prof-fill" style={{ width: `${pct}%`, background: color }} /></span>
    </div>
  );
}

export function ProfilerPanel() {
  const s = useSyncExternalStore(PerfMonitor.subscribe, PerfMonitor.getSnapshot);
  // Only while this panel is mounted does the loop pay for the engine-frame read.
  useEffect(() => PerfMonitor.addEngineConsumer(), []);
  const pinned = s.pinnedId != null ? PerfMonitor.getSample(s.pinnedId) : null;
  const [hidden, toggleGroup] = useHiddenGroups();
  const show = (id: string) => !hidden.has(id);

  // Sections read the pinned frame when one is inspected, else the live window.
  const v = pinned
    ? {
        frameMs: pinned.dt, engineMs: pinned.engineMs, editorMs: pinned.editorMs, presentWaitMs: pinned.presentWaitMs, gpuMs: pinned.gpuMs,
        drawCalls: pinned.drawCalls, triangles: pinned.triangles, entities: pinned.entities, systems: pinned.systems, counters: pinned.counters,
      }
    : {
        frameMs: s.p50, engineMs: s.engineMs, editorMs: s.editorMs, presentWaitMs: s.presentWaitMs, gpuMs: s.gpuMs,
        drawCalls: s.drawCalls, triangles: s.triangles, entities: s.entities, systems: s.systemsTop, counters: s.counters,
      };
  const counterRows = Object.entries(v.counters).sort((a, b) => a[0].localeCompare(b[0]));
  // Split the swap/vsync wait out of engine CPU: performance.now() around the render
  // system absorbs the present block, so its raw engineMs reads as work it never did.
  // engine → real CPU busy; presentWait → the blocked wait; idle → the rAF gap.
  const presentWait = v.presentWaitMs;
  const engineBusy = Math.max(0, v.engineMs - presentWait);
  const frame = Math.max(v.frameMs, engineBusy + v.editorMs + presentWait);
  const idle = Math.max(0, frame - engineBusy - v.editorMs - presentWait);
  const p99Bad = s.p99 >= BUDGET_MS * 1.5;
  // RenderSystem's raw timing includes the present wait; show its real CPU and list
  // the wait as its own dimmed row so the table ranks by work, not by vsync blocking.
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const sysRows: Array<{ name: string; ms: number; wait: boolean }> = v.systems
    .map((sys) => sys.name === 'RenderSystem'
      ? { name: sys.name, ms: Math.max(0, r1(sys.ms - presentWait)), wait: false }
      : { name: sys.name, ms: sys.ms, wait: false });
  if (presentWait >= 0.05) sysRows.push({ name: t('prof.presentWait'), ms: r1(presentWait), wait: true });
  sysRows.sort((a, b) => b.ms - a.ms);

  // The long tasks that hit the pinned frame + its measured phases, ranked.
  const longTasks = pinned ? PerfMonitor.getFrameLongTasks(pinned.id) : [];
  const measuredMs = pinned ? pinned.engineMs + pinned.editorMs : 0;
  const unattributedMs = pinned ? Math.max(0, pinned.dt - measuredMs) : 0;
  const breakdown: Array<[string, number]> = pinned
    ? [
        ...Object.entries(pinned.editorPhases),
        ...Object.entries(pinned.enginePhases).map(([n, m]) => [`engine.${n}`, m] as [string, number]),
        ...Object.entries(pinned.jsScopes).map(([n, m]) => [`js.${n}`, m] as [string, number]),
        ...Object.entries(pinned.cppScopes).map(([n, m]) => [`cpp.${n}`, m] as [string, number]),
        ...Object.entries(pinned.gpuScopes).map(([n, m]) => [`gpu.${n}`, m] as [string, number]),
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
          title={s.frozen ? t('prof.resumeLiveTitle') : t('prof.freezeTitle')}
        >
          {s.frozen ? t('prof.live') : t('prof.pause')}
        </button>
        <label className="prof-check">
          <input type="checkbox" checked={s.autoHitch} onChange={(e) => PerfMonitor.setAutoHitch(e.target.checked)} />
          {t('prof.pauseOnHitch')}
        </label>
        <button
          type="button"
          className={`prof-btn${s.recording ? ' rec' : ''}`}
          onClick={() => PerfMonitor.toggleRecording()}
          title={s.recording ? t('prof.stopRecTitle') : t('prof.recordTitle')}
        >
          {s.recording ? `● ${s.recordedFrames}` : t('prof.rec')}
        </button>
        <button type="button" className="prof-btn" onClick={downloadSession} title={t('prof.exportTitle')}>
          {t('prof.export')}
        </button>
        <span className="prof-spacer" />
        {pinned ? (
          <span className="prof-pinned">{t('prof.pinnedFrame', { id: pinned.id, ms: pinned.dt })}</span>
        ) : (
          <span className="prof-live">{t('prof.liveBadge')}</span>
        )}
      </div>

      <div className="prof-groups">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`chip prof-chip${hidden.has(g.id) ? '' : ' on'}`}
            onClick={() => toggleGroup(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Frame timing — history graph + percentiles (live) or the pinned frame. */}
      {show('frame') && (
      <section className="prof-sec">
        <h4>{t('prof.groupFrame')}</h4>
        <FrameGraph frames={s.frames} pinnedId={s.pinnedId} />
        {pinned ? (
          <div className="prof-budget">
            {t('prof.inspectingFrame', { id: pinned.id, ms: pinned.dt })}
            {pinned.dt >= BUDGET_30 ? <span className="prof-warn"> · {t('prof.hitch')}</span> : null}
            {' · '}<button type="button" className="prof-link" onClick={() => PerfMonitor.resumeLive()}>{t('prof.backToLive')}</button>
          </div>
        ) : (
          <>
            <div className="prof-stat-grid">
              <div><span>fps</span><b>{s.fps}</b></div>
              <div><span>p50</span><b>{s.p50}<i>ms</i></b></div>
              <div><span>p95</span><b>{s.p95}<i>ms</i></b></div>
              <div><span>p99</span><b style={{ color: p99Bad ? 'var(--warn)' : undefined }}>{s.p99}<i>ms</i></b></div>
            </div>
            <div className="prof-budget">
              {t('prof.budget', { ms: BUDGET_MS.toFixed(1) })} · {s.longFrames === 1 ? t('prof.longFrameOne', { count: s.longFrames }) : t('prof.longFrames', { count: s.longFrames })}
              {s.worstMs > 0 ? <> · {t('prof.worst', { ms: s.worstMs })} <em>({s.worstPhase ?? t('prof.other')})</em></> : null}
              {s.longTaskMs > 0 ? <span className="prof-warn"> · {t('prof.longTaskStat', { ms: s.longTaskMs })}</span> : null}
            </div>
          </>
        )}
      </section>
      )}

      {/* Frame = engine + editor + present; GPU is a parallel track. */}
      {show('unit') && (
      <section className="prof-sec">
        <h4>{t('prof.unitHeader')} <span className="prof-realm">· {s.realm}</span></h4>
        <Seg label={t('prof.engine')} ms={engineBusy} frame={frame} color="var(--run, #46a04a)" />
        <Seg label={t('prof.editor')} ms={v.editorMs} frame={frame} color="var(--star, #2f88d6)" />
        {presentWait >= 0.05 ? (
          <Seg label={t('prof.presentWait')} ms={presentWait} frame={frame} color="var(--warn, #d3a23c)" title={t('prof.presentWaitHint')} />
        ) : null}
        <Seg label={t('prof.idle')} ms={idle} frame={frame} color="var(--text-mute, #696a71)" />
        {v.gpuMs >= 0 ? (
          <Seg label="gpu" ms={v.gpuMs} frame={frame} color={GPU_COLOR} />
        ) : (
          <div className="prof-row">
            <span className="prof-key">gpu</span>
            <span className="prof-val prof-na">{t('prof.na')}</span>
            <span className="prof-bar" />
          </div>
        )}
      </section>
      )}

      {show('render') && (
      <section className="prof-sec">
        <h4>{t('prof.groupRender')}</h4>
        <div className="prof-stat-grid">
          <div><span>{t('prof.drawCalls')}</span><b>{v.drawCalls}</b></div>
          <div><span>{t('prof.triangles')}</span><b>{kfmt(v.triangles)}</b></div>
          <div><span>{t('prof.entities')}</span><b>{v.entities}</b></div>
        </div>
      </section>
      )}

      {show('counters') && counterRows.length > 0 && (
      <section className="prof-sec">
        <h4>{t('prof.groupCounters')}</h4>
        {counterRows.map(([name, val]) => (
          <div className="prof-brk" key={name}>
            <span className="prof-brk-name" title={name}>{name}</span>
            <span className="prof-brk-val">{kfmt(val)}</span>
          </div>
        ))}
      </section>
      )}

      {show('memory') && (
      <section className="prof-sec">
        <h4>{t('prof.groupMemory')}</h4>
        <MemGraph hist={s.memHist} />
        <div className="prof-stat-grid">
          <div><span style={{ color: 'var(--warn)' }}>wasm</span><b>{s.wasmMB}<i>MB</i></b></div>
          <div><span style={{ color: 'var(--star)' }}>{t('prof.jsHeap')}</span><b>{s.jsHeapMB || '—'}<i>{s.jsHeapMB ? 'MB' : ''}</i></b></div>
          <div><span style={{ color: GPU_COLOR }}>vram</span><b>{s.vramMB}<i>MB</i></b></div>
        </div>
        {s.jsHeapLimitMB ? <div className="prof-budget">{t('prof.jsHeapLimit', { mb: s.jsHeapLimitMB })}</div> : null}
      </section>
      )}

      {/* Pinned-frame attribution: the long task that hit it (the usual spike
          cause the phases can't name) + every measured phase, ranked. */}
      {pinned ? (
        <section className="prof-sec">
          <h4>{t('prof.breakdownHeader', { id: pinned.id })}</h4>
          {longTasks.map((lt, i) => {
            // The dominant same-frame zone that plausibly IS this long task.
            const cause = breakdown.find(([, ms]) => ms >= lt.ms * 0.5);
            return (
              <div className="prof-brk prof-lt" key={`lt${i}`}>
                <span className="prof-brk-name" title={lt.name}>
                  {t('prof.longTaskLabel')} {cause ? <>→ <b>{cause[0]}</b></> : t('prof.gcUninstrumented')}
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
            {t('prof.measured', { measured: measuredMs.toFixed(1), total: pinned.dt })}
            {unattributedMs >= 1 ? (
              <em> · {t('prof.unattributed', { ms: unattributedMs.toFixed(1) })}{longTasks.length ? '' : ` · ${t('prof.browserPaintGc')}`}</em>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Costliest engine systems — windowed max (live) or this frame's cost (pinned). */}
      {show('systems') && (
      <section className="prof-sec">
        <h4>{t('prof.groupSystems')}{pinned ? ` · ${t('prof.thisFrame')}` : ''}</h4>
        {sysRows.length ? (
          <table className="prof-sys">
            <tbody>
              {sysRows.map((sys) => (
                <tr
                  key={sys.name}
                  style={sys.wait ? { opacity: 0.6 } : undefined}
                  title={sys.wait ? t('prof.presentWaitHint') : undefined}
                >
                  <td>{sys.name}</td>
                  <td className="prof-sys-ms">{sys.ms}<i>ms</i></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="prof-empty">{t('prof.noSystemTimings')}</p>
        )}
      </section>
      )}
    </div>
  );
}
