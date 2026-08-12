// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ProfilerPanel.tsx — the dockable profiler panel.
 */
import { useSyncExternalStore, useRef, useEffect, useCallback, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { PerfMonitor, profileOf } from '@/engine/PerfMonitor';
import { parseProfileCapture, summarizeCapture, frameProfileOf } from 'esengine';
import type { ProfileNode, ProfileCapture, CaptureSummary, CapturedFrame } from 'esengine';
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
  a.download = `profile-${cap.generatedAt.replace(/[:.]/g, '-')}.esprof`;
  a.click();
  URL.revokeObjectURL(url);
}

/** A capture read off disk, and what it came to. Null while looking at the live realm. */
interface LoadedCapture {
  name: string;
  capture: ProfileCapture;
  summary: CaptureSummary;
}

async function pickCapture(): Promise<LoadedCapture | string> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.esprof,.json';
  const file = await new Promise<File | null>((resolve) => {
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
  if (!file) return '';
  const parsed = parseProfileCapture(await file.text());
  if ('error' in parsed) return `${file.name}: ${parsed.error}`;
  if (parsed.capture.frames.length === 0) return `${file.name}: the capture has no frames`;
  return { name: file.name, capture: parsed.capture, summary: summarizeCapture(parsed.capture) };
}

const GROUPS = [
  { id: 'frame', label: t('prof.groupFrame') },
  { id: 'unit', label: t('prof.groupUnit') },
  { id: 'tree', label: t('prof.groupTree') },
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
function FrameGraph({ frames, pinnedIdx, budgetMs, onPick }: {
  frames: number[];
  /** Index into `frames`, or -1 for none. */
  pinnedIdx: number;
  budgetMs: number;
  onPick: (index: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const budget30 = budgetMs * 2;

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
    const maxMs = Math.max(budget30 * 1.2, maxObserved * 1.1);
    const yOf = (ms: number) => h - (Math.min(ms, maxMs) / maxMs) * h;

    ctx.strokeStyle = grid;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(0, yOf(budgetMs)); ctx.lineTo(w, yOf(budgetMs)); ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, yOf(budget30)); ctx.lineTo(w, yOf(budget30)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const n = frames.length;
    if (!n) return;
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const ms = frames[i];
      const y = yOf(ms);
      ctx.fillStyle = ms >= budget30 ? err : ms >= budgetMs * 1.05 ? warn : accent;
      ctx.fillRect(i * bw, y, Math.max(1, bw - 0.4), h - y);
    }
    if (pinnedIdx >= 0) {
      const x = pinnedIdx * bw + bw / 2;
      ctx.strokeStyle = hi;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }, [frames, pinnedIdx, budgetMs, budget30]);

  const onClick = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    const cv = ref.current;
    if (!cv || frames.length === 0) return;
    const rect = cv.getBoundingClientRect();
    const n = frames.length;
    onPick(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * n))));
  }, [frames, onPick]);

  return <canvas ref={ref} className="prof-graph" title={t('prof.clickToInspect')} onClick={onClick} />;
}

// A query that walks the world every frame and then discards nearly all of it is
// the shape behind most "why is this system 7ms" — so the ratio is called out,
// not left for the reader to divide.
const MOSTLY_DISCARDED = 0.9;

/** What a system's queries walked, under the system whose time it explains. */
function QueryNote({ query, depth }: { query: NonNullable<ProfileNode['query']>; depth: number }) {
  const wasteful = query.scanned > 0 && query.filtered / query.scanned >= MOSTLY_DISCARDED;
  return (
    <div className={`prof-tree-row prof-tree-query${wasteful ? ' waste' : ''}`}>
      <span className="prof-tree-name" style={{ paddingLeft: `${(depth + 1) * 12 + 11}px` }}>
        {t('prof.queryScanned', { n: kfmt(query.scanned), calls: query.calls })}
        {query.filtered > 0 ? ` · ${t('prof.queryFiltered', { n: kfmt(query.filtered) })}` : ''}
      </span>
      <span />
      <span />
    </div>
  );
}

/** A domain / system / scope row, indented by depth and expandable while it has
 *  children. Share is of the whole frame, so depths stay comparable. */
function TreeRow({ node, frameMs, depth }: { node: ProfileNode; frameMs: number; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const pct = frameMs > 0 ? Math.min(100, (node.ms / frameMs) * 100) : 0;
  const hasKids = node.children.length > 0;
  return (
    <>
      <div className={`prof-tree-row prof-tree-${node.kind}`}>
        <button
          type="button"
          className="prof-tree-name"
          style={{ paddingLeft: `${depth * 12}px` }}
          onClick={() => hasKids && setOpen(!open)}
          disabled={!hasKids}
        >
          <span className="prof-tree-caret">{hasKids ? (open ? '▾' : '▸') : ''}</span>
          {node.label}
        </button>
        <span className="prof-tree-ms">{node.ms.toFixed(1)}<i>ms</i></span>
        <span className="prof-bar"><span className="prof-fill" style={{ width: `${pct}%` }} /></span>
      </div>
      {node.query ? <QueryNote query={node.query} depth={depth} /> : null}
      {open && node.children.map((c) => (
        <TreeRow key={c.id} node={c} frameMs={frameMs} depth={depth + 1} />
      ))}
    </>
  );
}

/**
 * A capture off disk, rendered by the same rows the live realm uses. Where it
 * came from is stated rather than implied: a file recorded on someone's phone
 * and the editor's own last second look identical once they are both a tree.
 */
function CaptureView({ loaded, frame, onPick, onClose }: {
  loaded: LoadedCapture;
  frame: CapturedFrame | null;
  onPick: (i: number | null) => void;
  onClose: () => void;
}) {
  const { capture, summary } = loaded;
  const profile = frame ? frameProfileOf(frame) : summary.mean;
  const src = capture.source;
  const origin = [src.label, src.platform, src.realm, src.gpu].filter(Boolean).join(' · ');
  return (
    <>
      <div className="prof-controls">
        <button type="button" className="prof-btn" onClick={onClose}>{t('prof.closeCapture')}</button>
        {frame ? (
          <button type="button" className="prof-btn" onClick={() => onPick(null)}>{t('prof.wholeCapture')}</button>
        ) : null}
        <span className="prof-spacer" />
        <span className="prof-pinned">{loaded.name}</span>
      </div>

      <section className="prof-sec">
        <h4>{t('prof.importedCapture')}</h4>
        <div className="prof-budget">
          {t('prof.captureOrigin', {
            frames: summary.frames,
            when: capture.generatedAt ? capture.generatedAt.slice(0, 19).replace('T', ' ') : '—',
            origin: origin || t('prof.unknownOrigin'),
          })}
        </div>
        <FrameGraph
          frames={capture.frames.map((f) => f.dtMs)}
          pinnedIdx={frame ? capture.frames.indexOf(frame) : -1}
          budgetMs={capture.budgetMs}
          onPick={onPick}
        />
        <div className="prof-stat-grid">
          <div><span>fps</span><b>{summary.fps}</b></div>
          <div><span>p50</span><b>{summary.p50.toFixed(1)}<i>ms</i></b></div>
          <div><span>p95</span><b>{summary.p95.toFixed(1)}<i>ms</i></b></div>
          <div><span>p99</span><b>{summary.p99.toFixed(1)}<i>ms</i></b></div>
        </div>
        <div className="prof-budget">
          {t('prof.budget', { ms: capture.budgetMs.toFixed(1) })}
          {' · '}{t('prof.longFrames', { count: summary.longFrames })}
          {' · '}{t('prof.worst', { ms: summary.worstFrameMs.toFixed(1) })}
        </div>
      </section>

      <section className="prof-sec">
        <h4>
          {t('prof.groupTree')}
          <span className="prof-realm"> · {frame ? t('prof.frameN', { id: frame.id }) : t('prof.captureMean')}</span>
        </h4>
        <div className="prof-tree">
          {profile.domains.map((d) => (
            <TreeRow key={d.id} node={d} frameMs={profile.frameMs} depth={0} />
          ))}
        </div>
        <div className="prof-budget">
          {t('prof.treeTotals', {
            frame: profile.frameMs.toFixed(1),
            cpu: profile.cpuMs.toFixed(1),
            wait: profile.waitMs.toFixed(1),
            idle: profile.idleMs.toFixed(1),
          })}
        </div>
      </section>

      <section className="prof-sec">
        <h4>{t('prof.groupRender')}</h4>
        <div className="prof-stat-grid">
          <div><span>{t('prof.drawCalls')}</span><b>{Math.round(frame?.drawCalls ?? summary.drawCalls)}</b></div>
          <div><span>{t('prof.triangles')}</span><b>{kfmt(Math.round(frame?.triangles ?? summary.triangles))}</b></div>
          <div><span>{t('prof.entities')}</span><b>{Math.round(frame?.entities ?? summary.entities)}</b></div>
        </div>
      </section>

      <section className="prof-sec">
        <h4>{t('prof.groupCounters')}</h4>
        {Object.entries<number>(frame?.counters ?? summary.counters)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([name, val]) => (
            <div className="prof-brk" key={name}>
              <span className="prof-brk-name" title={name}>{name}</span>
              <span className="prof-brk-val">{kfmt(Math.round(val))}</span>
            </div>
          ))}
      </section>
    </>
  );
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
  const [loaded, setLoaded] = useState<LoadedCapture | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loadedFrameIdx, setLoadedFrameIdx] = useState<number | null>(null);
  const pinned = s.pinnedId != null ? PerfMonitor.getSample(s.pinnedId) : null;
  const [hidden, toggleGroup] = useHiddenGroups();
  const show = (id: string) => !hidden.has(id);

  const openCapture = useCallback(async () => {
    const r = await pickCapture();
    if (typeof r === 'string') { if (r) setLoadError(r); return; }
    setLoadError('');
    setLoadedFrameIdx(null);
    setLoaded(r);
  }, []);

  // A loaded capture answers every section, so the panel is a viewer of one
  // whether it came off disk or off the running realm.
  const loadedFrame = loaded && loadedFrameIdx != null ? loaded.capture.frames[loadedFrameIdx] ?? null : null;
  if (loaded) {
    return (
      <div className="prof">
        <CaptureView
          loaded={loaded}
          frame={loadedFrame}
          onPick={setLoadedFrameIdx}
          onClose={() => { setLoaded(null); setLoadedFrameIdx(null); }}
        />
      </div>
    );
  }

  // Sections read the pinned frame when one is inspected, else the live window.
  const profile = pinned ? profileOf(pinned) : s.profile;
  const v = pinned
    ? {
        frameMs: pinned.dt, engineMs: pinned.engineMs, editorMs: pinned.editorMs, presentWaitMs: pinned.presentWaitMs, gpuMs: pinned.gpuMs,
        drawCalls: pinned.drawCalls, triangles: pinned.triangles, entities: pinned.entities, counters: pinned.counters,
        systems: profile ? profile.domains.flatMap((d) => d.children).sort((a, b) => b.ms - a.ms).slice(0, 8)
          .map((n) => ({ name: n.label, ms: n.ms })) : [],
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
  // Editor phases and GPU passes only: the engine's own CPU is the tree's, and
  // listing its systems and scopes flat beside it double-counts every scope.
  const breakdown: Array<[string, number]> = pinned
    ? [
        ...Object.entries(pinned.editorPhases),
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
        <button type="button" className="prof-btn" onClick={() => void openCapture()} title={t('prof.openTitle')}>
          {t('prof.open')}
        </button>
        <span className="prof-spacer" />
        {pinned ? (
          <span className="prof-pinned">{t('prof.pinnedFrame', { id: pinned.id, ms: pinned.dt })}</span>
        ) : (
          <span className="prof-live">{t('prof.liveBadge')}</span>
        )}
      </div>

      {loadError ? <div className="prof-budget prof-warn">{loadError}</div> : null}

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
        <FrameGraph
          frames={s.frames}
          pinnedIdx={s.pinnedId != null ? PerfMonitor.getSamples().findIndex((x) => x.id === s.pinnedId) : -1}
          budgetMs={BUDGET_MS}
          onPick={(i) => {
            const sample = PerfMonitor.getSamples()[i];
            if (sample) PerfMonitor.pin(sample.id);
          }}
        />
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

      {/* Where the frame went, by cost domain. One frame, so the rows add up. */}
      {show('tree') && (
      <section className="prof-sec">
        <h4>
          {t('prof.groupTree')}
          <span className="prof-realm"> · {pinned ? t('prof.thisFrame') : t('prof.lastFrame')}</span>
        </h4>
        {profile && profile.domains.length > 0 ? (
          <>
            <div className="prof-tree">
              {profile.domains.map((d) => (
                <TreeRow key={d.id} node={d} frameMs={profile.frameMs} depth={0} />
              ))}
            </div>
            <div className="prof-budget">
              {t('prof.treeTotals', {
                frame: profile.frameMs.toFixed(1),
                cpu: profile.cpuMs.toFixed(1),
                wait: profile.waitMs.toFixed(1),
                idle: profile.idleMs.toFixed(1),
              })}
            </div>
          </>
        ) : (
          <p className="prof-empty">{t('prof.noSystemTimings')}</p>
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
        <h4>{t('prof.groupSystems')} <span className="prof-realm">· {pinned ? t('prof.thisFrame') : t('prof.windowMax')}</span></h4>
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
