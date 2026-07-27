// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  BuildDialog.tsx — the "Package Project" modal.
 *        Pick a target platform + configuration + output, hit Build, watch the
 *        cook → bundle → copy run, then reveal the output.
 *
 *        Layout: a category'd platform nav on the left, that platform's settings on
 *        the right — the same shape (and the same visual language) as the Settings
 *        dialog's section nav, because the platform list only grows: mini-game
 *        vendors, mobile targets, and whatever a project defines for itself. A row
 *        of tiles could not take that.
 *
 *        The list is assembled, not hardcoded. Built-ins supply their icon/label/
 *        blurb here; the main process supplies READINESS (is this target's engine
 *        runtime actually on disk?) and any platform the project defines in
 *        `.esengine/platforms/`. So a target says what it needs BEFORE a build runs,
 *        and a project's own vendor sits in the list beside the built-ins.
 *
 *        Altitude: this dialog is the *publish* layer, so it does NOT carry
 *        per-asset optimization. Texture compression / Max Size / audio bitrate are
 *        authored per asset in the Inspector's Import Settings; the build only
 *        chooses whether to HONOR those settings (`assetCompression: 'auto'`) or
 *        skip them for fast iteration (`'skip'`). Every target is live.
 */
import { useState, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import {
  Loader2, FolderOpen, CheckCircle2, AlertCircle, Boxes, Info, Copy, ExternalLink, Play,
  Globe, Monitor, MessageSquare, ChevronRight, Smartphone, Apple, Package, TriangleAlert, Plus,
} from 'lucide-react';
import type { ExportPlatform, NativeToolchain, PlatformPrereq } from '@/project/platforms';
import type { PlayableNetworkOption } from '../../electron/platformCatalog';
import { Modal } from '@/components/Modal';
import { Segmented } from '@/components/Segmented';
import { Select } from '@/components/Select';
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
  /** Size of the file that gets uploaded (playable: the archive, else the HTML). */
  bytes?: number;
  /** The archive a zip-delivery ad network needs (playable). */
  zipFile?: string;
  warnings: string[];
  errors: string[];
  /** iOS: the .xcodeproj the export wrote around its content. */
  xcodeProject?: string;
  /** Android: the signed APK the export assembled. */
  apkFile?: string;
  /** Android: the App Bundle, when the project asked for one. */
  aabFile?: string;
}

/** Nav groupings. Order here is the order they appear. */
type PlatformCategory = 'general' | 'minigame' | 'mobile' | 'custom';

const CATEGORY_ORDER: PlatformCategory[] = ['general', 'minigame', 'mobile', 'custom'];
const CATEGORY_LABEL: Record<PlatformCategory, string> = {
  general: t('build.cat.general'),
  minigame: t('build.cat.minigame'),
  mobile: t('build.cat.mobile'),
  custom: t('build.cat.custom'),
};

/** Per-platform packaging descriptor — drives the contextual UI + guidance. */
interface PlatformDef {
  id: Platform;
  label: string;
  ready: boolean;
  category: PlatformCategory;
  /** Defined by the project rather than shipped by the editor. */
  custom?: boolean;
  /** A project platform whose profile module threw — shown, not swallowed. */
  loadError?: string;
  /** The command that produces this target's missing runtime (probed, not assumed). */
  fixCommand?: string;
  /** Target glyph shown in the nav. */
  icon: ReactNode;
  /** One-line description of the target (shown under the platform row). */
  blurb: string;
  defaultOut: string;
  /** Whether the source-maps option applies to this target. */
  sourceMaps: boolean;
  /** A build prerequisite to surface BEFORE packaging (missing toolchain/runtime). */
  prereq?: string;
  /** What KIND of prerequisite — a missing engine runtime blocks the package, a
   *  missing native toolchain only blocks the final app assembly. */
  prereqKind?: PlatformPrereq['kind'];
  /** The runtime template this target wants, when that is what is missing. Kept so
   *  the install action can say which version a wrong archive should have been. */
  templateWant?: { id: string; version: string };
  /** http-servable target → offer a loopback-http Preview (opening the build via
   *  file:// hits the browser's opaque-origin rules; http is its real surface). */
  httpPreview?: boolean;
  /** Post-build guidance (where the package is / how to run it). */
  next: (outDir: string) => string;
}

/** The targets the editor ships. Readiness is filled in from the main process —
 *  the static "requires the X runtime" lines these used to carry showed whether or
 *  not you had built it, and one of them (playable) was simply wrong: that export
 *  inlines the WEB runtime, not a `-t playable` one. */
const BUILTIN_PLATFORMS: PlatformDef[] = [
  {
    id: 'web', label: t('build.plat.web'), ready: true, category: 'general', icon: <Globe size={17} />,
    blurb: t('build.blurb.web'),
    defaultOut: 'dist-web', sourceMaps: true, httpPreview: true,
    next: (o) => t('build.next.web', { out: o }),
  },
  {
    id: 'desktop', label: t('build.plat.desktop'), ready: true, category: 'general', icon: <Monitor size={17} />,
    blurb: t('build.blurb.desktop'),
    defaultOut: 'dist-desktop', sourceMaps: true,
    next: (o) => t('build.next.desktop', { out: o }),
  },
  {
    id: 'wechat', label: t('build.plat.wechat'), ready: true, category: 'minigame', icon: <MessageSquare size={17} />,
    blurb: t('build.blurb.wechat'),
    defaultOut: 'dist-wechat', sourceMaps: false,
    next: (o) => t('build.next.wechat', { out: o }),
  },
  {
    id: 'playable', label: t('build.plat.playable'), ready: true, category: 'general', icon: <Play size={16} />,
    blurb: t('build.blurb.playable'),
    defaultOut: 'dist-playable', sourceMaps: false, httpPreview: true,
    next: () => t('build.next.playable'),
  },
  // The two mobile targets export the same content — a native app carries the
  // engine and the SDK in its binary — but they are separate rows because
  // everything AROUND that differs: the toolchain, whether this machine has it,
  // and the command that turns the content into an installable app.
  {
    id: 'android', label: t('build.plat.android'), ready: true, category: 'mobile', icon: <Smartphone size={17} />,
    blurb: t('build.blurb.android'),
    defaultOut: 'dist-android', sourceMaps: false,
    next: (o) => t('build.next.android', { out: o }),
  },
  {
    id: 'ios', label: t('build.plat.ios'), ready: true, category: 'mobile', icon: <Apple size={17} />,
    blurb: t('build.blurb.ios'),
    defaultOut: 'dist-ios', sourceMaps: false,
    next: (o) => t('build.next.ios', { out: o }),
  },
];

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Localized names for the native toolchain pieces the main process probes. */
const TOOLCHAIN_TEXT: Record<NativeToolchain, string> = {
  xcode: t('build.needXcode'),
  macos: t('build.needMacos'),
};

/** The main process reports WHAT is missing; the sentence is written here, where
 *  the locale is. */
function prereqText(r: { prereq?: PlatformPrereq }): string | undefined {
  if (!r.prereq) return undefined;
  if (r.prereq.kind === 'toolchain-missing') return TOOLCHAIN_TEXT[r.prereq.tool];
  if (r.prereq.kind === 'template-missing') {
    return t('build.templateMissing', { id: r.prereq.id, version: r.prereq.version });
  }
  // A built-in target comes with the command that fixes it, and WHERE the editor
  // keeps its runtime is not the developer's business — the command is. A project
  // platform has no command (only the project knows how it builds one), so there
  // the searched dir IS the actionable fact: it is a path the project configured.
  if (r.prereq.command) return t('build.notReady');
  return t('build.runtimeMissingIn', { dir: r.prereq.dir, files: r.prereq.looked.join(', ') });
}

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
  const initialDef = BUILTIN_PLATFORMS.find((p) => p.id === initialPlatform) ?? BUILTIN_PLATFORMS[0];

  // The built-ins are what we can draw immediately; readiness and the project's
  // own platforms arrive from the main process (both are filesystem facts).
  const [platforms, setPlatforms] = useState<PlatformDef[]>(BUILTIN_PLATFORMS);

  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const [config, setConfig] = useState<Config>(saved.config ?? 'shipping');
  const [outDir, setOutDir] = useState(saved.outDir?.[initialPlatform] ?? initialDef.defaultOut);
  const [openFolder, setOpenFolder] = useState(saved.openFolder ?? true);
  const [sourceMaps, setSourceMaps] = useState(saved.sourceMaps ?? false);
  // Publish-layer optimization switch: honor each asset's Import Settings, or skip
  // compression entirely for fast iteration. The per-asset decisions live in the
  // Inspector; this only picks whether to apply them.
  const [assetCompression, setAssetCompression] = useState<AssetCompression>(saved.assetCompression ?? 'auto');
  // Which ad network a playable is packaged for. It belongs HERE rather than in
  // Project Settings: shipping the same game to several networks is a normal day, and
  // that is a per-build decision, not a property of the project. The list arrives from
  // the main process, since it includes the networks the PROJECT defines.
  const [adNetwork, setAdNetwork] = useState<string>(saved.platforms?.playable?.network ?? 'generic');
  // The Play upload format, beside the installable APK. A per-build decision that
  // the project remembers, like the ad network above.
  const [appBundle, setAppBundle] = useState(saved.platforms?.android?.appBundle ?? false);
  const [adNetworks, setAdNetworks] = useState<PlayableNetworkOption[]>([]);
  const [advOpen, setAdvOpen] = useState(false);
  const [copiedFix, setCopiedFix] = useState(false);
  // The scaffolding pane: a pseudo-selection, so the nav keeps working while it shows.
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('my-platform');
  const [newLabel, setNewLabel] = useState('My Platform');
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; packaging: string; runtime?: string } | null>(null);
  // Mini-game vendor or playable ad network — two extension points, one form. A
  // network is NOT a platform row (it is chosen inside the playable target), so
  // creating one lands on a note rather than on a new selection.
  const [newKind, setNewKind] = useState<'minigame' | 'playable'>('minigame');
  const [createdNetwork, setCreatedNetwork] = useState<{ id: string; file: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [log, setLog] = useState<string[]>([]);
  // Active build profile's CDN root (asset-groups.json) — where remote-group
  // assets are fetched from for hot update. Written on blur.
  const [cdnRoot, setCdnRoot] = useState(() => ProjectStore.activeProfileRemoteRoot());

  const def = platforms.find((p) => p.id === platform) ?? platforms[0];
  const running = phase === 'running';
  // Bumped when something the probes read changes on disk (a runtime template is
  // installed), so the rows re-probe instead of the dialog having to be reopened.
  const [probeTick, setProbeTick] = useState(0);
  const [templateNote, setTemplateNote] = useState<{ text: string; error: boolean } | null>(null);
  const [downloading, setDownloading] = useState<{ received: number; total: number } | null>(null);

  // Progress is pushed from main while a template downloads.
  useEffect(() => window.estella.nativeTemplates?.onDownloadProgress?.((p) => {
    setDownloading({ received: p.received, total: p.total });
  }), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const rows = (await window.estella.project?.listPlatforms?.()) ?? [];
      if (!alive || rows.length === 0) return;
      const byId = new Map(rows.map((r) => [r.id, r]));
      const merged: PlatformDef[] = BUILTIN_PLATFORMS.map((p) => {
        const r = byId.get(p.id);
        if (!r) return p;
        // A probed prerequisite replaces the static one.
        return {
          ...p, ready: r.ready, prereq: prereqText(r), prereqKind: r.prereq?.kind,
          fixCommand: r.prereq?.kind === 'runtime-missing' ? r.prereq.command : undefined,
          templateWant: r.prereq?.kind === 'template-missing'
            ? { id: r.prereq.id, version: r.prereq.version } : undefined,
        };
      });
      for (const r of rows) {
        if (r.source !== 'project') continue;
        merged.push({
          id: r.id,
          label: r.label ?? r.id,
          ready: r.ready,
          category: 'custom',
          custom: true,
          // An unapproved profile was NOT imported, so say why rather than
          // showing an unexplained not-ready row.
          loadError: r.needsTrust ? t('build.platformNeedsTrust') : r.error,
          icon: <Package size={17} />,
          blurb: r.blurb ?? t('build.customHint'),
          defaultOut: r.defaultOut ?? `dist-${r.id}`,
          sourceMaps: false,
          prereq: prereqText(r),
          prereqKind: r.prereq?.kind,
          // A project platform is always a runtime probe (it rides the mini-game
          // pipeline), but read the kind rather than assume it.
          fixCommand: r.prereq?.kind === 'runtime-missing' ? r.prereq.command : undefined,
          next: (o) => t('build.next.custom', { out: o }),
        });
      }
      setPlatforms(merged);
      // A project platform restored from settings has no descriptor until now, so
      // the output box opened on the built-in fallback's default — correct it,
      // unless the project saved an explicit dir for it.
      const cur = merged.find((p) => p.id === platform);
      if (cur && !saved.outDir?.[platform]) setOutDir(cur.defaultOut);
    })();
    return () => { alive = false; };
    // The catalog is read when the dialog opens, and again when a probe's input
    // changed (probeTick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeTick]);

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

  const refreshNetworks = async (): Promise<PlayableNetworkOption[]> => {
    const rows = (await window.estella.project?.listPlayableNetworks?.()) ?? [];
    setAdNetworks(rows);
    return rows;
  };

  useEffect(() => {
    let live = true;
    void window.estella.project?.listPlayableNetworks?.().then((rows) => {
      if (live) setAdNetworks(rows ?? []);
    });
    return () => { live = false; };
  }, []);

  /** Each network gets its own output dir, so packaging for one does not overwrite
   *  the last — except the unnamed default, which keeps the plain folder. */
  const playableOut = (network: string): string => (network === 'generic' ? 'dist-playable' : `dist-playable/${network}`);

  const selectedNetwork = adNetworks.find((n) => n.id === adNetwork);

  const pickNetwork = (network: string) => {
    // Follow the output only while it is still a default; never overwrite a path the
    // developer typed.
    if (outDir === playableOut(adNetwork)) setOutDir(playableOut(network));
    setAdNetwork(network);
    setPhase('idle');
    setResult(null);
  };

  const pickPlatform = (p: PlatformDef) => {
    // A not-ready target is still selectable: seeing WHY it is not ready is the
    // point, and what a build may attempt is the developer's call.
    setPlatform(p.id);
    setPhase('idle');
    setResult(null);
    // Restore this platform's saved output, else its suggested default.
    setOutDir(saved.outDir?.[p.id] ?? (p.id === 'playable' ? playableOut(adNetwork) : p.defaultOut));
  };

  const startCreate = () => {
    setCreating(true);
    setCreated(null);
    setCreateErr(null);
  };

  const createPlatform = async () => {
    setCreateErr(null);
    const res = await window.estella.project?.createPlatform?.(newId.trim(), newLabel.trim(), newKind);
    if (!res?.ok) {
      setCreateErr(res?.error ?? t('build.packageFailed'));
      return;
    }
    const id = newId.trim();
    // An ad network joins the playable target's network list, not the platform nav.
    if (newKind === 'playable') {
      setCreatedNetwork({ id, file: res.packagingFile! });
      // Re-read the list so the new network is selectable NOW, and select it: it was
      // just written, so it is what the developer means to package with.
      const rows = await refreshNetworks();
      setCreating(false);
      setPlatform('playable');
      if (rows.some((r) => r.id === id)) {
        setAdNetwork(id);
        setOutDir(playableOut(id));
      }
      setPhase('idle');
      setResult(null);
      return;
    }
    setCreated({ id, packaging: res.packagingFile!, runtime: res.runtimeFile! });
    // Re-read the catalog so the new platform joins the nav, then select it.
    const rows = (await window.estella.project?.listPlatforms?.()) ?? [];
    const row = rows.find((r) => r.id === id);
    if (row) {
      setPlatforms((prev) => [
        ...prev.filter((p) => p.id !== row.id),
        {
          id: row.id, label: row.label ?? row.id, ready: row.ready, category: 'custom', custom: true,
          loadError: row.error, icon: <Package size={17} />, blurb: row.blurb ?? t('build.customHint'),
          defaultOut: row.defaultOut ?? `dist-${row.id}`, sourceMaps: false,
          prereq: prereqText(row), prereqKind: row.prereq?.kind,
          fixCommand: row.prereq?.kind === 'runtime-missing' ? row.prereq.command : undefined,
          next: (o) => t('build.next.custom', { out: o }),
        },
      ]);
      // Land ON the new platform rather than leaving the form up: the footer and
      // the Package button both act on the selection, and a form that is not a
      // selection would have them acting on the previous one.
      setCreating(false);
      setPlatform(row.id);
      setOutDir(row.defaultOut ?? `dist-${row.id}`);
      setPhase('idle');
      setResult(null);
    }
  };

  const copyFix = (cmd: string) => {
    void navigator.clipboard?.writeText(cmd);
    setCopiedFix(true);
    setTimeout(() => setCopiedFix(false), 1600);
  };

  /** Report the outcome of getting a template, and re-probe when it worked: the
   *  row that asked for it becomes ready without reopening the dialog. */
  const afterTemplate = (res: { ok: boolean; id?: string; engineVersion?: string; versionMismatch?: boolean; error?: string }) => {
    if (!res.ok) {
      setTemplateNote({ text: res.error ?? '', error: true });
      return;
    }
    if (res.versionMismatch) {
      setTemplateNote({
        text: t('build.templateVersionMismatch', {
          version: res.engineVersion ?? '', editor: def.templateWant?.version ?? '',
        }),
        error: true,
      });
    } else {
      setTemplateNote({
        text: t('build.templateInstalled', { id: res.id ?? '', version: res.engineVersion ?? '' }),
        error: false,
      });
    }
    setProbeTick((n) => n + 1);
  };

  /** Install an archive the user already has (offline, a mirror, a company share). */
  const installTemplate = async () => {
    const res = await window.estella.nativeTemplates?.install?.();
    if (!res || res.canceled) return;
    afterTemplate(res);
  };

  /** Fetch it from this version's release. */
  const downloadTemplate = async (platform: string) => {
    if (platform !== 'android' && platform !== 'ios') return;
    setTemplateNote(null);
    setDownloading({ received: 0, total: 0 });
    try {
      const res = await window.estella.nativeTemplates?.download?.(platform);
      if (res) afterTemplate(res);
    } finally {
      setDownloading(null);
    }
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
    // Awaited, not fired-and-forgotten: the export resolves the network from the
    // manifest, so a race here would package for the previous one.
    if (platform === 'playable') await ProjectStore.setPlatformPackaging('playable', { network: adNetwork });
    // Same reason: the export reads the bundle choice from the manifest.
    if (platform === 'android') await ProjectStore.setPlatformPackaging('android', { appBundle });
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
    <Modal title={t('build.title')} onClose={running ? () => {} : close} footer={footer} width={720}>
      <div className="build">
        <nav className="build__nav" aria-label={t('build.platform')}>
          {CATEGORY_ORDER.map((cat) => {
            const items = platforms.filter((p) => p.category === cat);
            // The custom group always shows, so a project that has none still
            // learns the capability exists.
            if (items.length === 0 && cat !== 'custom') return null;
            return (
              <div key={cat} className="build__nav-group">
                <div className="build__nav-sec">
                  <span>{CATEGORY_LABEL[cat]}</span>
                  {cat === 'custom' && (
                    <button
                      type="button"
                      className="build__nav-add"
                      title={t('build.newPlatform')}
                      aria-label={t('build.newPlatform')}
                      disabled={running || !project}
                      onClick={startCreate}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
                {items.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`build__nav-item${!creating && platform === p.id ? ' active' : ''}`}
                    aria-current={!creating && platform === p.id}
                    disabled={running}
                    title={p.label}
                    onClick={() => { setCreating(false); pickPlatform(p); }}
                  >
                    <span className="build__nav-icon">{p.icon}</span>
                    <span className="build__nav-label">{p.label}</span>
                    {p.loadError
                      ? <AlertCircle size={12} className="build__nav-flag is-error" />
                      : !p.ready
                        ? <TriangleAlert size={12} className="build__nav-flag is-warn" />
                        : null}
                  </button>
                ))}
                {cat === 'custom' && items.length === 0 && (
                  <div className="build__nav-empty">{t('build.noCustomPlatforms')}</div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="build__content">
          {creating ? (
            <>
              <div className="build__head">
                <span className="build__head-title">{t('build.newPlatformTitle')}</span>
                <span className="build__blurb">{t('build.newPlatformBlurb')}</span>
              </div>
              <Group title={t('build.newPlatform')}>
                <div className="build__row">
                  <span className="build__label">{t('build.platformKind')}</span>
                  <Segmented
                    value={newKind}
                    onChange={(v) => setNewKind(v as 'minigame' | 'playable')}
                    ariaLabel={t('build.platformKind')}
                    options={[
                      { value: 'minigame', label: t('build.platformKind.minigame') },
                      { value: 'playable', label: t('build.platformKind.playable') },
                    ]}
                  />
                </div>
                <div className="build__row">
                  <span className="build__label" title={t('build.platformIdTip')}>{t('build.platformId')}</span>
                  <input value={newId} spellCheck={false} onChange={(e) => setNewId(e.target.value)} />
                </div>
                <div className="build__row">
                  <span className="build__label">{t('build.platformLabel')}</span>
                  <input value={newLabel} spellCheck={false} onChange={(e) => setNewLabel(e.target.value)} />
                </div>
                <div className="build__row">
                  <span className="build__label" />
                  <Button variant="primary" onClick={() => void createPlatform()}>
                    <Plus size={13} /> {t('build.create')}
                  </Button>
                </div>
              </Group>
              {createErr && (
                <div className="build__prereq is-error">
                  <AlertCircle size={13} /> <span className="selectable">{createErr}</span>
                </div>
              )}
            </>
          ) : (
          <>
          <div className="build__head">
            <span className="build__head-title">{def.label}</span>
            <span className="build__blurb">{def.blurb}</span>
          </div>

          {createdNetwork && def.id === 'playable' && (
            <div className="build__prereq">
              <CheckCircle2 size={13} />
              <div className="build__prereq-body">
                <span className="selectable">
                  {t('build.createdNetwork', { file: createdNetwork.file, label: createdNetwork.id })}
                </span>
              </div>
            </div>
          )}

          {created?.id === def.id && (
            <div className="build__prereq">
              <CheckCircle2 size={13} />
              <div className="build__prereq-body">
                <span className="selectable">
                  {t('build.created', { packaging: created.packaging, runtime: created.runtime ?? '' })}
                </span>
                <div className="build__fix">
                  <Button onClick={() => void window.estella.shell?.showItem?.(created.packaging)}>
                    <FolderOpen size={12} /> {t('build.revealFiles')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {def.loadError && (
            <div className="build__prereq is-error">
              <AlertCircle size={13} />
              <span className="selectable">{t('build.platformBroken')} — {def.loadError}</span>
            </div>
          )}

          {!def.ready && !def.loadError && (
            <div className="build__prereq is-warn">
              <TriangleAlert size={13} />
              <div className="build__prereq-body">
                <span className="selectable">{def.prereq ?? t('build.notReady')}</span>
                {/* A missing engine runtime means no package at all; a missing
                    native toolchain still exports the app's content — only the
                    assembly step (which may run on another machine) needs it. */}
                <span className="build__prereq-hint">
                  {def.prereqKind === 'toolchain-missing' ? t('build.toolchainHint')
                    : def.prereqKind === 'template-missing' ? t('build.templateHint')
                      : t('build.notReadyHint')}
                </span>
                {def.prereqKind === 'template-missing' && (
                  <div className="build__fix">
                    <Button variant="primary" disabled={!!downloading} onClick={() => void downloadTemplate(def.id)}>
                      {downloading
                        ? <><Loader2 size={12} className="spin" /> {downloading.total > 0
                          ? t('build.downloadingTemplatePct', {
                            pct: String(Math.round((downloading.received / downloading.total) * 100)),
                            size: mb(downloading.total),
                          })
                          : t('build.downloadingTemplate')}</>
                        : <><Package size={12} /> {t('build.downloadTemplate')}</>}
                    </Button>
                    <Button disabled={!!downloading} onClick={() => void installTemplate()}>
                      {t('build.installTemplate')}
                    </Button>
                    {templateNote && (
                      <span className={templateNote.error ? 'is-error selectable' : 'selectable'}>
                        {templateNote.text}
                      </span>
                    )}
                  </div>
                )}
                {def.fixCommand && (
                  <div className="build__fix">
                    <code className="selectable">{def.fixCommand}</code>
                    <Button onClick={() => copyFix(def.fixCommand!)}>
                      <Copy size={12} /> {copiedFix ? t('build.copied') : t('build.copyCommand')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

        <Group title={t('build.secBuild')}>
          {platform === 'android' && (
            <label className="build__opt" title={t('build.appBundleTip')}>
              <input type="checkbox" checked={appBundle} onChange={(e) => setAppBundle(e.target.checked)} />
              {t('build.appBundle')}
            </label>
          )}
          {platform === 'playable' && (
            <>
              <div className="build__row">
                <span className="build__label" title={t('build.adNetworkTip')}>{t('build.adNetwork')}</span>
                <Select
                  ariaLabel={t('build.adNetwork')}
                  value={adNetwork}
                  options={(adNetworks.length > 0 ? adNetworks : [{ id: adNetwork, label: adNetwork, source: 'builtin' as const }])
                    .map((n) => ({ value: n.id, label: n.error ? `${n.label} ⚠` : n.label }))}
                  onChange={pickNetwork}
                />
              </div>
              {/* A network the PROJECT wrote is a file it must be able to find again —
                  the dialog is the only place that knows which file that is. */}
              {selectedNetwork?.file && (
                <div className={`build__prereq${selectedNetwork.error ? ' is-error' : ''}`}>
                  {selectedNetwork.error ? <AlertCircle size={13} /> : <Info size={13} />}
                  <div className="build__prereq-body">
                    <span className="selectable">
                      {selectedNetwork.error
                        ? `${selectedNetwork.file} — ${selectedNetwork.error}`
                        : t('build.adNetworkFile', { file: selectedNetwork.file })}
                    </span>
                    <div className="build__fix">
                      <Button onClick={() => void window.estella.shell?.showItem?.(selectedNetwork.file!)}>
                        <FolderOpen size={12} /> {t('build.revealFiles')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <div className="build__hint">
                <Info size={11} /> {t('build.adNetworkHint')}
              </div>
            </>
          )}
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
                <div className="build__next selectable">
                  {result.xcodeProject
                    ? t('build.next.iosProject')
                    : result.apkFile
                      ? (result.aabFile
                      ? t('build.next.apkAab', { apk: result.apkFile, aab: result.aabFile })
                      : t('build.next.apk', { apk: result.apkFile }))
                      : result.zipFile
                        ? t('build.next.playableZip')
                        : def.next(result.outDir)}
                </div>
                {result.ok && (
                  <div className="build__actions">
                    {def.httpPreview && (
                      <Button variant="primary" onClick={() => void preview()}>
                        <ExternalLink size={13} /> {t('build.previewHttp')}
                      </Button>
                    )}
                    {result.xcodeProject && (
                      <Button variant="primary" onClick={() => void window.estella.shell?.openPath?.(result.xcodeProject!)}>
                        <ExternalLink size={13} /> {t('build.openXcode')}
                      </Button>
                    )}
                    {result.apkFile && (
                      <Button variant="primary" onClick={() => void window.estella.shell?.showItem?.(result.apkFile!)}>
                        <FolderOpen size={13} /> {t('build.showApk')}
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
          </>
          )}
        </div>
      </div>
    </Modal>
  );
}
