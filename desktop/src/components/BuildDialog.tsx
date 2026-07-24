// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  BuildDialog.tsx — the "Package Project" modal.
 *        Pick a target platform + configuration + output, hit Build, watch the
 *        cook → bundle → copy run, then reveal the output. The dialog is driven by
 *        a per-platform descriptor table ({@link PLATFORMS}): each platform supplies
 *        its icon, blurb, default output, which options apply, any build prerequisite,
 *        and the post-build next-steps — so the UI is contextual per target.
 *
 *        Altitude: this dialog is the *publish* layer, so it does NOT carry
 *        per-asset optimization. Texture compression / Max Size / audio bitrate are
 *        authored per asset in the Inspector's Import Settings; the build only
 *        chooses whether to HONOR those settings (`assetCompression: 'auto'`) or
 *        skip them for fast iteration (`'skip'`). Every target is live.
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Loader2, FolderOpen, CheckCircle2, AlertCircle, Boxes, Info, Copy, ExternalLink, Play,
  Globe, Monitor, MessageSquare, ChevronRight, Smartphone,
} from 'lucide-react';
import type { ExportPlatform } from '@/project/format';
import { Modal } from '@/components/Modal';
import { Segmented } from '@/components/Segmented';
import { Button } from '@/components/Button';
import { ProjectStore } from '@/project/ProjectStore';
import { useEditorStore } from '@/store/editorStore';
import { t } from '@/i18n';

type Phase = 'idle' | 'running' | 'done' | 'error';
type Config = 'development' | 'shipping';
type Platform = ExportPlatform;
type AssetCompression = 'auto' | 'skip';

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
  /** Target glyph shown on the platform tile. */
  icon: ReactNode;
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
    id: 'web', label: t('build.plat.web'), ready: true, icon: <Globe size={17} />,
    blurb: t('build.blurb.web'),
    defaultOut: 'dist-web', sourceMaps: true, httpPreview: true,
    next: (o) => t('build.next.web', { out: o }),
  },
  {
    id: 'desktop', label: t('build.plat.desktop'), ready: true, icon: <Monitor size={17} />,
    blurb: t('build.blurb.desktop'),
    defaultOut: 'dist-desktop', sourceMaps: true,
    next: (o) => t('build.next.desktop', { out: o }),
  },
  {
    id: 'wechat', label: t('build.plat.wechat'), ready: true, icon: <MessageSquare size={17} />,
    blurb: t('build.blurb.wechat'),
    defaultOut: 'dist-wechat', sourceMaps: false,
    prereq: t('build.prereq.wechat'),
    next: (o) => t('build.next.wechat', { out: o }),
  },
  {
    id: 'playable', label: t('build.plat.playable'), ready: true, icon: <Play size={16} />,
    blurb: t('build.blurb.playable'),
    defaultOut: 'dist-playable', sourceMaps: false, httpPreview: true,
    prereq: t('build.prereq.playable'),
    next: () => t('build.next.playable'),
  },
  {
    id: 'native', label: t('build.plat.native'), ready: true, icon: <Smartphone size={17} />,
    blurb: t('build.blurb.native'),
    defaultOut: 'dist-native', sourceMaps: false,
    prereq: t('build.prereq.native'),
    next: (o) => t('build.next.native', { out: o }),
  },
];

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A titled section box — gives the dialog visual grouping instead of a flat column. */
function Group({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  return (
    <div className="build__group">
      <div className="build__group-head">
        <span className="build__group-title">{title}</span>
        {count && <span className="build__group-count">{count}</span>}
      </div>
      <div className="build__group-body">{children}</div>
    </div>
  );
}

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
  // Publish-layer optimization switch: honor each asset's Import Settings, or skip
  // compression entirely for fast iteration. The per-asset decisions live in the
  // Inspector; this only picks whether to apply them.
  const [assetCompression, setAssetCompression] = useState<AssetCompression>(saved.assetCompression ?? 'auto');
  const [advOpen, setAdvOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [log, setLog] = useState<string[]>([]);
  // Active build profile's CDN root (asset-groups.json) — where remote-group
  // assets are fetched from for hot update. Written on blur.
  const [cdnRoot, setCdnRoot] = useState(() => ProjectStore.activeProfileRemoteRoot());

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
  const shippedScenes = sceneList.filter((s) => s.path === project?.defaultScene || !excludedScenes.has(s.path)).length;

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
    void ProjectStore.setPackaging({ platform, config, sourceMaps, openFolder, assetCompression, outDir: { [platform]: outDir } });
    // 'auto' → honor each asset's Import Settings (the cook then reads per-asset
    // texture/audio compression + Max Size); 'skip' → ship everything raw.
    const compress = assetCompression === 'auto';
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
        compressTextures: compress,
        atlasTextures: compress,
        compressAudio: compress,
      })) as Result | null;
      if (!res) {
        setResult({ ok: false, outDir, included: 0, warnings: [], errors: [t('build.noProjectOpen')] });
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
      {phase === 'idle' && <span className="build__footsum">{t('build.footSummary', { count: shippedScenes, platform: def.label })}</span>}
      <Button onClick={close} disabled={running}>
        {phase === 'done' ? t('ui.close') : t('ui.cancel')}
      </Button>
      <Button variant="primary" onClick={() => void build()} disabled={running || !project}>
        {running ? (
          <>
            <Loader2 size={14} className="spin" /> {t('build.packaging')}
          </>
        ) : (
          <>
            <Boxes size={14} /> {t('build.package')}
          </>
        )}
      </Button>
    </>
  );

  return (
    <Modal title={t('build.title')} onClose={running ? () => {} : close} footer={footer} width={520}>
      <div className="build">
        <div className="build__label">{t('build.platform')}</div>
        <div className="build__platforms">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`build__plat${platform === p.id ? ' on' : ''}`}
              disabled={!p.ready}
              aria-pressed={platform === p.id}
              title={p.ready ? p.label : t('build.comingSoon')}
              onClick={() => pickPlatform(p)}
            >
              {p.icon}
              <span className="build__plat-name">{p.label}</span>
            </button>
          ))}
        </div>
        <div className="build__blurb">{def.blurb}</div>

        {def.prereq && (
          <div className="build__prereq">
            <Info size={13} /> <span className="selectable">{def.prereq}</span>
          </div>
        )}

        <Group title={t('build.secBuild')}>
          <div className="build__row">
            <span className="build__label">{t('build.configuration')}</span>
            <Segmented
              ariaLabel={t('build.configuration')}
              value={config}
              options={[
                { value: 'development', label: t('build.development') },
                { value: 'shipping', label: t('build.shipping') },
              ]}
              onChange={setConfig}
            />
          </div>
          <div className="build__row">
            <span className="build__label" title={t('build.assetCompressionTip')}>{t('build.assetCompression')}</span>
            <Segmented
              ariaLabel={t('build.assetCompression')}
              value={assetCompression}
              options={[
                { value: 'auto', label: t('build.assetAuto') },
                { value: 'skip', label: t('build.assetSkip') },
              ]}
              onChange={setAssetCompression}
            />
          </div>
          <div className="build__hint">
            <Info size={11} /> {t('build.compressionHint')}
          </div>
          <div className="build__row">
            <span className="build__label">{t('build.output')}</span>
            <div className="build__out">
              <input
                value={outDir}
                spellCheck={false}
                onChange={(e) => setOutDir(e.target.value)}
              />
              <Button onClick={() => void browse()}>
                <FolderOpen size={13} /> {t('build.browse')}
              </Button>
            </div>
          </div>
        </Group>

        {/* Scenes in build — the same single source the exporters read
            (defaultScene + packaging.excludeScenes), edited in place. The
            startup scene is pinned: it boots the game, so it always ships. */}
        <Group title={t('build.scenesHead')} count={String(sceneList.length)}>
          <div className="build__scenes-list">
            {sceneList.map((s) => {
              const isEntry = s.path === project?.defaultScene;
              const ships = isEntry || !excludedScenes.has(s.path);
              return (
                <div key={s.path} className={`build__scene${ships ? '' : ' is-excluded'}`}>
                  <button
                    type="button"
                    className={`build__scene-start${isEntry ? ' is-on' : ''}`}
                    title={isEntry ? t('build.startupScene') : t('build.setStartupScene')}
                    aria-label={isEntry ? t('build.startupScene') : t('build.setStartupSceneNamed', { name: s.name })}
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
            {sceneList.length === 0 && <div className="build__scenes-empty">{t('build.noScenes')}</div>}
            {platform === 'playable' && sceneList.length > 1 && (
              <div className="build__scenes-note">{t('build.playableSingleScene')}</div>
            )}
          </div>
        </Group>

        <button
          type="button"
          className={`build__adv${advOpen ? ' open' : ''}`}
          aria-expanded={advOpen}
          onClick={() => setAdvOpen((o) => !o)}
        >
          <span className="chev"><ChevronRight size={13} /></span>
          {t('build.advanced')}
        </button>
        {advOpen && (
          <div className="build__adv-body">
            <div className="build__row">
              <span className="build__label" title={t('build.cdnRootTip')}>{t('build.cdnRoot')}</span>
              <input
                value={cdnRoot}
                spellCheck={false}
                placeholder="https://cdn…"
                title={t('build.cdnRootTip')}
                onChange={(e) => setCdnRoot(e.target.value)}
                onBlur={() => void ProjectStore.setActiveProfileRemoteRoot(cdnRoot.trim())}
              />
            </div>
            {def.sourceMaps && (
              <label className="build__opt">
                <input type="checkbox" checked={sourceMaps} onChange={(e) => setSourceMaps(e.target.checked)} />
                {t('build.includeSourceMaps')}
              </label>
            )}
            <label className="build__opt">
              <input type="checkbox" checked={openFolder} onChange={(e) => setOpenFolder(e.target.checked)} />
              {t('build.openFolderWhenDone')}
            </label>
          </div>
        )}

        {phase !== 'idle' && (
          <div className={`build__status ${phase}`}>
            {phase === 'running' && (
              <span className="build__status-line">
                <Loader2 size={14} className="spin" /> {t('build.packagingPlatform', { platform: def.label })}
              </span>
            )}
            {log.length > 0 && (
              <div className="build__logwrap">
                <div className="build__loghead">
                  <span className="build__loglabel">{t('build.outputLog')}</span>
                  <button type="button" className="build__copy" title={t('build.copyLog')} aria-label={t('build.copyLog')} onClick={copyLog}>
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
                  <CheckCircle2 size={14} /> {t('build.packagedSummary', { count: result.included, size: result.bytes ? ` · ${mb(result.bytes)}` : '', out: result.outDir })}
                </span>
                <div className="build__next selectable">{def.next(result.outDir)}</div>
                {result.ok && (
                  <div className="build__actions">
                    {def.httpPreview && (
                      <Button variant="primary" onClick={() => void preview()}>
                        <ExternalLink size={13} /> {t('build.previewHttp')}
                      </Button>
                    )}
                    <Button onClick={() => void window.estella.shell?.openPath?.(result.outDir)}>
                      <FolderOpen size={13} /> {t('build.openFolder')}
                    </Button>
                  </div>
                )}
              </>
            )}
            {phase === 'error' && result && (
              <span className="build__status-line selectable">
                <AlertCircle size={14} /> {result.errors[0] ?? t('build.packageFailed')}
              </span>
            )}
            {result && result.warnings.length > 0 && (
              <div className="build__warn selectable">{t('build.warnings', { count: result.warnings.length, first: result.warnings[0] })}</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
