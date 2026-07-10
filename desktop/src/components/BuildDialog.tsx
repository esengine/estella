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
import { Loader2, FolderOpen, CheckCircle2, AlertCircle, Boxes, Info, Copy, ExternalLink, Play } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Segmented } from '@/components/Segmented';
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
  /** http-servable target → offer a loopback-http Preview (opening the build via
   *  file:// hits the browser's opaque-origin rules; http is its real surface). */
  httpPreview?: boolean;
  /** Post-build guidance (where the package is / how to run it). */
  next: (outDir: string) => string;
}

const PLATFORMS: PlatformDef[] = [
  {
    id: 'web', label: 'Web', ready: true,
    blurb: 'Static, self-contained web build — host it anywhere.',
    defaultOut: 'dist-web', sourceMaps: true, httpPreview: true,
    next: (o) => `Preview over http below, or upload ${o}/ to any static host. (A web build needs an http origin — opening index.html directly won't stream the wasm.)`,
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
    defaultOut: 'dist-playable', sourceMaps: false, httpPreview: true,
    prereq: 'Requires the single-file runtime — run: node build-tools/cli.js build -t playable',
    next: () => `Preview over http below (its real surface is an ad-network iframe). Note: a full engine usually exceeds ad-network size limits.`,
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
  const [compressTextures, setCompressTextures] = useState(saved.compressTextures ?? false);
  const [atlasTextures, setAtlasTextures] = useState(saved.atlasTextures ?? false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const def = PLATFORMS.find((p) => p.id === platform)!;
  const running = phase === 'running';

  // The build's scene set, mirroring the exporter's discovery: every scene
  // under the project's scenes dir (plus the entry wherever it lives), entry
  // first. Reads the live asset index, so it tracks file changes.
  const scenesDir = project?.layout?.scenes ?? 'assets/scenes';
  const excludedScenes = new Set(project?.packaging?.excludeScenes ?? []);
  const sceneList = ProjectStore.listAssets()
    .filter((a) => a.type === 'scene' && (a.path.startsWith(`${scenesDir}/`) || a.path === project?.defaultScene))
    .sort((a, b) =>
      a.path === project?.defaultScene ? -1 : b.path === project?.defaultScene ? 1 : a.path.localeCompare(b.path));

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
    void ProjectStore.setPackaging({ platform, config, sourceMaps, openFolder, compressTextures, atlasTextures, outDir: { [platform]: outDir } });
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
        compressTextures,
        atlasTextures,
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

  // Serve the finished build over loopback http and open it in the default browser —
  // its real deployment surface, so none of the file:// opaque-origin limits apply.
  const preview = async () => {
    if (!result?.ok) return;
    try {
      await window.estella.project?.previewExport?.(result.outDir);
    } catch (err) {
      setLog((l) => [...l, `preview failed: ${err instanceof Error ? err.message : String(err)}`]);
    }
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
          <Segmented
            ariaLabel="Configuration"
            value={config}
            options={[
              { value: 'development', label: 'Development' },
              { value: 'shipping', label: 'Shipping' },
            ]}
            onChange={setConfig}
          />
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
        <label className="build__opt">
          <input type="checkbox" checked={compressTextures} onChange={(e) => setCompressTextures(e.target.checked)} />
          Compress textures (PNG → KTX2)
        </label>
        <label className="build__opt">
          <input type="checkbox" checked={atlasTextures} onChange={(e) => setAtlasTextures(e.target.checked)} />
          Pack .atlas folders into atlases
        </label>

        {def.prereq && (
          <div className="build__prereq">
            <Info size={13} /> <span className="selectable">{def.prereq}</span>
          </div>
        )}

        {/* Scenes in build — the same single source the exporters read
            (defaultScene + packaging.excludeScenes), edited in place. The
            startup scene is pinned: it boots the game, so it always ships. */}
        <div className="build__scenes">
          <div className="build__scenes-head">Scenes in build</div>
          {sceneList.map((s) => {
            const isEntry = s.path === project?.defaultScene;
            const ships = isEntry || !excludedScenes.has(s.path);
            return (
              <div key={s.path} className={`build__scene${ships ? '' : ' is-excluded'}`}>
                <button
                  type="button"
                  className={`build__scene-start${isEntry ? ' is-on' : ''}`}
                  title={isEntry ? 'Startup scene' : 'Set as startup scene'}
                  aria-label={isEntry ? 'Startup scene' : `Set ${s.name} as startup scene`}
                  disabled={running || isEntry}
                  onClick={() => void ProjectStore.setDefaultScene(s.path)}
                >
                  <Play size={11} strokeWidth={2.5} />
                </button>
                <label className="build__scene-row">
                  <input
                    type="checkbox"
                    checked={ships}
                    disabled={running || isEntry}
                    onChange={(e) => void ProjectStore.setSceneExcluded(s.path, !e.target.checked)}
                  />
                  <span className="build__scene-name">{s.name.replace(/\.esscene$/i, '')}</span>
                  <span className="build__scene-path mono">{s.path}</span>
                </label>
              </div>
            );
          })}
          {sceneList.length === 0 && <div className="build__scenes-empty">No scenes found under the project's scenes folder.</div>}
          {platform === 'playable' && sceneList.length > 1 && (
            <div className="build__scenes-note">Playable ships the startup scene only — a size-capped single file.</div>
          )}
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
                {result.ok && (
                  <div className="build__actions">
                    {def.httpPreview && (
                      <button type="button" className="btn-soft is-primary" onClick={() => void preview()}>
                        <ExternalLink size={13} /> Preview over http
                      </button>
                    )}
                    <button type="button" className="btn-soft" onClick={() => void window.estella.shell?.openPath?.(result.outDir)}>
                      <FolderOpen size={13} /> Open folder
                    </button>
                  </div>
                )}
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
