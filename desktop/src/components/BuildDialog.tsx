// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  BuildDialog.tsx — the UE5-style "Package Project" modal.
 *        Pick a target platform + configuration + output, hit Build, watch the
 *        cook → bundle → copy run, then reveal the output. The dialog is driven by
 *        a per-platform descriptor table ({@link PLATFORMS}): each platform supplies
 *        its blurb, default output, which options apply, any build prerequisite, and
 *        the post-build next-steps — so the UI is contextual per target (UE-style)
 *        rather than one fixed option set. All four targets (Web / Desktop / WeChat
 *        / Playable) are live.
 */
import { useState, useSyncExternalStore } from 'react';
import { Loader2, FolderOpen, CheckCircle2, AlertCircle, Boxes, Info, Copy } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { ProjectStore } from '@/project/ProjectStore';
import { useEditorStore } from '@/store/editorStore';

type Phase = 'idle' | 'running' | 'done' | 'error';
type Config = 'development' | 'shipping';
type Platform = 'web' | 'desktop' | 'wechat' | 'playable';

interface Result {
  ok: boolean;
  outDir: string;
  included: number;
  /** Final size in bytes (playable single-file export). */
  bytes?: number;
  warnings: string[];
  errors: string[];
}

/** Per-platform packaging descriptor — drives the contextual UI + guidance. */
interface PlatformDef {
  id: Platform;
  label: string;
  ready: boolean;
  /** One-line description of the target (shown under the platform row). */
  blurb: string;
  defaultOut: string;
  /** Whether the source-maps option applies to this target. */
  sourceMaps: boolean;
  /** A build prerequisite to surface BEFORE packaging (missing toolchain/runtime). */
  prereq?: string;
  /** Post-build guidance (where the package is / how to run it). */
  next: (outDir: string) => string;
}

const PLATFORMS: PlatformDef[] = [
  {
    id: 'web', label: 'Web', ready: true,
    blurb: 'Static, self-contained web build — host it anywhere.',
    defaultOut: 'dist-web', sourceMaps: true,
    next: (o) => `Open ${o}/index.html, or upload ${o}/ to any static host.`,
  },
  {
    id: 'desktop', label: 'Desktop', ready: true,
    blurb: 'Electron app — package to .dmg / .exe / AppImage.',
    defaultOut: 'dist-desktop', sourceMaps: true,
    next: (o) => `cd ${o} && npm install && npm start — or npm run dist for a native installer.`,
  },
  {
    id: 'wechat', label: 'WeChat', ready: true,
    blurb: 'WeChat MiniGame package.',
    defaultOut: 'dist-wechat', sourceMaps: false,
    prereq: 'Requires the WeChat runtime — run: node build-tools/cli.js build -t wechat',
    next: (o) => `Open ${o}/ in WeChat DevTools, then set your appid in project.config.json.`,
  },
  {
    id: 'playable', label: 'Playable', ready: true,
    blurb: 'Single-file HTML playable ad — everything inlined, no requests.',
    defaultOut: 'dist-playable', sourceMaps: false,
    prereq: 'Requires the single-file runtime — run: node build-tools/cli.js build -t playable',
    next: (o) => `Open ${o}/index.html. Note: a full engine usually exceeds ad-network size limits.`,
  },
];

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function BuildDialog() {
  const close = () => useEditorStore.getState().setBuildOpen(false);
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);

  // Restore the project's persisted Package Project settings (project.esproject).
  const [saved] = useState(() => ProjectStore.packagingSettings());
  const initialPlatform: Platform = saved.platform ?? 'web';
  const initialDef = PLATFORMS.find((p) => p.id === initialPlatform) ?? PLATFORMS[0];

  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const [config, setConfig] = useState<Config>(saved.config ?? 'shipping');
  const [outDir, setOutDir] = useState(saved.outDir?.[initialPlatform] ?? initialDef.defaultOut);
  const [openFolder, setOpenFolder] = useState(saved.openFolder ?? true);
  const [sourceMaps, setSourceMaps] = useState(saved.sourceMaps ?? false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const def = PLATFORMS.find((p) => p.id === platform)!;
  const running = phase === 'running';

  const pickPlatform = (p: PlatformDef) => {
    if (!p.ready) return;
    setPlatform(p.id);
    setPhase('idle');
    setResult(null);
    // Restore this platform's saved output, else its suggested default.
    setOutDir(saved.outDir?.[p.id] ?? p.defaultOut);
  };

  const browse = async () => {
    const dir = await window.estella.project?.chooseDirectory?.();
    if (dir) setOutDir(dir);
  };

  const build = async () => {
    setPhase('running');
    setResult(null);
    setLog([]);
    // Persist the chosen settings to project.esproject (restored next time).
    void ProjectStore.setPackaging({ platform, config, sourceMaps, openFolder, outDir: { [platform]: outDir } });
    // Live build log (UE-style): each export phase streams over IPC.
    const unsub = window.estella.project?.onExportProgress?.((p) =>
      setLog((l) => [...l, p.detail ? `${p.phase} — ${p.detail}` : p.phase]),
    );
    try {
      const res = (await ProjectStore.exportGame({
        platform,
        outDir,
        minify: config === 'shipping',
        sourcemap: def.sourceMaps && sourceMaps,
      })) as Result | null;
      if (!res) {
        setResult({ ok: false, outDir, included: 0, warnings: [], errors: ['no project open'] });
        setPhase('error');
        return;
      }
      setResult(res);
      setPhase(res.ok ? 'done' : 'error');
      if (res.ok && openFolder) void window.estella.shell?.openPath?.(res.outDir);
    } catch (err) {
      setResult({ ok: false, outDir, included: 0, warnings: [], errors: [err instanceof Error ? err.message : String(err)] });
      setPhase('error');
    } finally {
      unsub?.();
    }
  };

  const copyLog = () => {
    const lines = [...log];
    if (result?.errors?.length) lines.push(...result.errors.map((e) => `ERROR: ${e}`));
    if (result?.warnings?.length) lines.push(...result.warnings.map((w) => `warning: ${w}`));
    void navigator.clipboard?.writeText(lines.join('\n'));
  };

  const footer = (
    <>
      <button type="button" className="btn-soft" onClick={close} disabled={running}>
        {phase === 'done' ? 'Close' : 'Cancel'}
      </button>
      <button type="button" className="btn-soft is-primary" onClick={() => void build()} disabled={running || !project}>
        {running ? (
          <>
            <Loader2 size={14} className="spin" /> Packaging…
          </>
        ) : (
          <>
            <Boxes size={14} /> Package
          </>
        )}
      </button>
    </>
  );

  return (
    <Modal title="Package Project" onClose={running ? () => {} : close} footer={footer} width={500}>
      <div className="build">
        <div className="build__label">Platform</div>
        <div className="build__platforms">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`build__plat${platform === p.id ? ' on' : ''}`}
              disabled={!p.ready}
              aria-pressed={platform === p.id}
              title={p.ready ? p.label : 'Coming soon'}
              onClick={() => pickPlatform(p)}
            >
              {p.label}
              {!p.ready && <span className="soon">soon</span>}
            </button>
          ))}
        </div>
        <div className="build__blurb">{def.blurb}</div>

        <div className="build__row">
          <span className="build__label">Configuration</span>
          <div className="build__seg">
            <button type="button" className={config === 'development' ? 'on' : ''} onClick={() => setConfig('development')}>
              Development
            </button>
            <button type="button" className={config === 'shipping' ? 'on' : ''} onClick={() => setConfig('shipping')}>
              Shipping
            </button>
          </div>
        </div>

        <div className="build__row">
          <span className="build__label">Output</span>
          <div className="build__out">
            <input
              value={outDir}
              spellCheck={false}
              onChange={(e) => setOutDir(e.target.value)}
            />
            <button type="button" className="btn-soft" onClick={() => void browse()}>
              <FolderOpen size={13} /> Browse
            </button>
          </div>
        </div>

        <label className="build__opt">
          <input type="checkbox" checked={openFolder} onChange={(e) => setOpenFolder(e.target.checked)} />
          Open output folder when done
        </label>
        {def.sourceMaps && (
          <label className="build__opt">
            <input type="checkbox" checked={sourceMaps} onChange={(e) => setSourceMaps(e.target.checked)} />
            Include source maps
          </label>
        )}

        {def.prereq && (
          <div className="build__prereq">
            <Info size={13} /> <span className="selectable">{def.prereq}</span>
          </div>
        )}

        <div className="build__summary">
          Entry: <strong>{project?.defaultScene ?? '—'}</strong>
        </div>

        {phase !== 'idle' && (
          <div className={`build__status ${phase}`}>
            {phase === 'running' && (
              <span className="build__status-line">
                <Loader2 size={14} className="spin" /> Packaging the {def.label} build…
              </span>
            )}
            {log.length > 0 && (
              <div className="build__logwrap">
                <div className="build__loghead">
                  <span className="build__loglabel">Output Log</span>
                  <button type="button" className="build__copy" title="Copy log" aria-label="Copy log" onClick={copyLog}>
                    <Copy size={13} />
                  </button>
                </div>
                <ol className="build__log selectable">
                  {log.map((line, i) => <li key={i}>{line}</li>)}
                </ol>
              </div>
            )}
            {phase === 'done' && result && (
              <>
                <span className="build__status-line selectable">
                  <CheckCircle2 size={14} /> Packaged {result.included} assets{result.bytes ? ` · ${mb(result.bytes)}` : ''} → {result.outDir}
                </span>
                <div className="build__next selectable">{def.next(result.outDir)}</div>
              </>
            )}
            {phase === 'error' && result && (
              <span className="build__status-line selectable">
                <AlertCircle size={14} /> {result.errors[0] ?? 'Package failed'}
              </span>
            )}
            {result && result.warnings.length > 0 && (
              <div className="build__warn selectable">{result.warnings.length} warning(s): {result.warnings[0]}</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
