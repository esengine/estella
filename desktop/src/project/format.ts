// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project format — pure types + layout resolution.
 *
 * Shared by the Electron main process (which reads/writes the files) and the
 * renderer (ProjectStore). Deliberately free of node/electron imports so both
 * builds can consume it. See RC12 §E7.
 *
 * A project is a directory containing:
 *   project.esproject        — committed identity/config (this manifest)
 *   .esengine/workspace.json — editor-local, transient state (gitignored)
 *   assets/scenes/*.esscene, assets/textures/* (+ .meta), src/  — by convention
 *
 * The committed manifest is the established `project.esproject` (which the build
 * tooling already uses as the project marker); this consolidates the editor onto
 * it, adding a manifest formatVersion + migration and moving editor-local state
 * into workspace.json.
 */

import { parseAudioProjectConfig, type AudioProjectConfig } from 'esengine';

export const PROJECT_FORMAT_VERSION = '1';
export const PROJECT_MANIFEST_FILE = 'project.esproject';
export const WORKSPACE_DIR = '.esengine';
export const WORKSPACE_FILE = 'workspace.json';

/** Resolved directory layout (relative to project root). */
export interface ProjectLayout {
  scenes: string;
  textures: string;
  src: string;
}

export const DEFAULT_LAYOUT: ProjectLayout = {
  scenes: 'assets/scenes',
  textures: 'assets/textures',
  src: 'src',
};

/** Reference resolution the project is designed against (camera / UI scaling). */
export interface DesignResolution {
  width: number;
  height: number;
}

/**
 * Script entry points. Splitting declaration from
 * startup is what lets the editor extract a component schema WITHOUT executing
 * project startup: schema extraction imports ONLY `register`, the play-realm
 * bundle is built from `main`. Both default (see {@link DEFAULT_SCRIPTS}) so most
 * projects need no entry here.
 */
export interface ProjectScripts {
  /** Pure declaration module — `defineComponent`/`defineTag` only, no startup. */
  register?: string;
  /** Startup/entry module — `createWebApp`/`run`; the play-realm bundle entry. */
  main?: string;
}

/**
 * Engine features (subsystems) the project enables — the UE5 `.uproject`
 * "Plugins" analog. Declaring physics here installs it in the play realm /
 * exported game even when the static scene carries no bodies (e.g. a project
 * that spawns RigidBodies from a script at runtime). Absence ⇒ off; physics also
 * auto-installs when a scene actually uses physics components.
 */
export interface ProjectFeatures {
  physics?: {
    enabled?: boolean;
    gravity?: { x: number; y: number };
    /** Names for the 16 Box2D collision-filter layers (the inspector's layer masks). */
    collisionLayers?: string[];
    /** Per-layer collision masks (the UE/Unity collision matrix): masks[i] bit j set ⇒
     *  layer i collides with layer j. 16 entries; absent ⇒ all-collide. */
    collisionLayerMasks?: number[];
    /** World solver tuning (Project Settings → Physics); absent ⇒ engine defaults. */
    fixedTimestep?: number;
    subStepCount?: number;
    contactHertz?: number;
    contactDampingRatio?: number;
    contactSpeed?: number;
    enableSleep?: boolean;
    enableContinuous?: boolean;
  };
  rendering?: {
    /** Named render sorting layers (the inspector's `layer` dropdown); index = z-order. */
    sortingLayers?: string[];
    /** Indices of sorting layers that y-sort within the layer (top-down occlusion). */
    ySortLayers?: number[];
    /** Render color space. 'linear' = linear-light pipeline (sRGB decode on
     *  sample, linear blending, OETF at the final blit). Fixed at engine boot —
     *  shaders compile against it. Absent ⇒ 'gamma'. */
    colorSpace?: 'linear';
    /** How the MAIN camera fits the design resolution, INDEPENDENT of any UI Canvas
     *  (the runtime's ScreenScaling). Absent/'none' ⇒ the camera keeps its raw
     *  orthoSize (Canvas fit when present) — the zero-regression default. */
    cameraScaleMode?: CameraScaleMode;
    /** Match-mode blend 0..1 (0 = fit width, 1 = fit height); cameraScaleMode='match' only. */
    cameraMatch?: number;
  };
  /** Project mixer state (bus volumes / custom buses / effects / duck rules). */
  audio?: AudioProjectConfig;
  ui?: {
    /** Built-in widget theme. Only 'light' persists; dark (the default) is
     *  expressed by absence — like rendering.colorSpace. */
    theme?: 'light';
  };
}

export type ScreenOrientation = 'portrait' | 'landscape';

/** Project camera fit — how the main camera scales the design resolution (a superset of
 *  the engine's CanvasScaleMode names, plus 'none' = off). See {@link cameraScaleModeValue}. */
export type CameraScaleMode = 'none' | 'fixed-width' | 'fixed-height' | 'expand' | 'shrink' | 'match';

/** Per-platform packaging config (the platform-specific Project Settings pages).
 *  Orientation is NOT here — it is one project-wide {@link ProjectPackaging.orientation}
 *  consumed by every target (a landscape build is landscape everywhere). */
export interface WeChatPackaging { appid?: string; }
export interface DesktopPackaging { appId?: string; productName?: string; }

/** Persisted Package Project settings (UE's ProjectPackagingSettings analog) —
 *  committed with the project so the build dialog restores the last target/config
 *  and the export reads per-platform config. */
export interface ProjectPackaging {
  platform?: 'web' | 'desktop' | 'wechat' | 'playable';
  config?: 'development' | 'shipping';
  sourceMaps?: boolean;
  openFolder?: boolean;
  /** Screen orientation for EVERY export target (WeChat game.json deviceOrientation,
   *  the web/playable rotate-to-fit hint, the desktop window's aspect). Absent ⇒
   *  derived from the design resolution's aspect (see {@link resolveOrientation}) —
   *  so a landscape design ships landscape with zero config. */
  orientation?: ScreenOrientation;
  /** Cook PNGs to GPU-ready KTX2 (Basis Universal). */
  compressTextures?: boolean;
  /** Cook WAV sources to MP3 (per-asset Import Settings can override). */
  compressAudio?: boolean;
  /** Pack `<name>.atlas/` folders into atlas pages at cook time. */
  atlasTextures?: boolean;
  /** Project-relative scene paths NOT shipped as switchable scenes (dev/test
   *  scenes). Everything else under the scenes dir exports; the startup scene
   *  always ships regardless. */
  excludeScenes?: string[];
  /** Per-platform output-dir overrides (else the per-platform default). */
  outDir?: Partial<Record<'web' | 'desktop' | 'wechat' | 'playable', string>>;
  /** Per-platform packaging config (appid, app id, …). */
  platforms?: { wechat?: WeChatPackaging; desktop?: DesktopPackaging };
}

/** Committed project identity + config (`project.esproject`). */
export interface ProjectManifest {
  /** Manifest schema version (migration-aware; rejects newer than supported). */
  formatVersion: string;
  name: string;
  /** The project's own version (semver-ish), informational. */
  version?: string;
  /** Engine build the project targets (ties to E1's build id). */
  engineBuildId?: string;
  /** Entry scene, project-relative. The editor opens this unless workspace overrides. */
  defaultScene?: string;
  /** Design resolution for the viewport / camera. */
  designResolution?: DesignResolution;
  /** Spine runtime the project needs ('none' | '3.8' | '4.1' | '4.2' …). */
  spineVersion?: string;
  /** Per-path overrides of {@link DEFAULT_LAYOUT}. */
  layout?: Partial<ProjectLayout>;
  /** Declaration/startup entry points (defaults in {@link DEFAULT_SCRIPTS}). */
  scripts?: ProjectScripts;
  /** One-line summary, shown when the project is used as a New-project template. */
  description?: string;
  /** Short category label for the template gallery (e.g. "2D", "Physics"). */
  tag?: string;
  /** Engine features (subsystems) the project enables; see {@link ProjectFeatures}. */
  features?: ProjectFeatures;
  /** Persisted Package Project settings; see {@link ProjectPackaging}. */
  packaging?: ProjectPackaging;
}

/** A New-project template (a project directory used as a starting point). */
export interface TemplateEntry {
  name: string;
  dir: string;
  /** Which gallery group the template belongs to: a bundled blank-slate
   *  starter, or one of the sample projects. */
  kind: 'starter' | 'example';
  description?: string;
  tag?: string;
  thumbnail?: string;
}

// Per-machine / derived state that must never travel when a project directory
// is copied as a template: the editor restages `.esengine` (typings, caches,
// workspace) on open, and the rest is tooling output.
const TEMPLATE_TRANSIENT = new Set([WORKSPACE_DIR, 'node_modules', 'dist', '.DS_Store', 'Thumbs.db']);

/** True if a template-relative path is transient state (excluded from template copies). */
export function isTransientProjectPath(rel: string): boolean {
  return rel.split(/[\\/]/).some((seg) => TEMPLATE_TRANSIENT.has(seg));
}

/** Editor-local, transient state (`.esengine/workspace.json`; gitignored). */
export interface WorkspaceState {
  lastOpenedScene?: string;
  panelLayout?: unknown;
}

/** An opened project as returned over IPC (plain, structured-clone-safe). */
export interface OpenedProject {
  root: string;
  manifest: ProjectManifest;
  workspace: WorkspaceState;
  /** Staging that failed while adopting the project (e.g. the `.esengine/sdk`
   *  types mirror couldn't find the SDK dist). The project still opens — but
   *  the renderer must say so LOUDLY: a silently skipped mirror is exactly how
   *  "cannot find module 'esengine'" shipped without a trace (issue #49). */
  stagingError?: string;
}

/** A directory entry from a sandboxed readdir. */
export interface DirEntry {
  name: string;
  isDir: boolean;
}

/** A recent project for the launcher (thumbnail is a data URL, if present). */
export interface RecentEntry {
  name: string;
  root: string;
  openedAt: number;
  /** engineBuildId or version from the manifest, for the build badge. */
  build?: string;
  thumbnail?: string;
}

const versionNum = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Parse + validate a raw `project.esproject` value. Throws on malformed / too-new. */
export function parseManifest(raw: unknown): ProjectManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('project.esproject must be a JSON object');
  }
  const o = raw as Record<string, unknown>;
  const formatVersion = typeof o.formatVersion === 'string' ? o.formatVersion : '1';
  if (versionNum(formatVersion) > versionNum(PROJECT_FORMAT_VERSION)) {
    throw new Error(
      `project.esproject formatVersion "${formatVersion}" is newer than this editor ` +
      `supports ("${PROJECT_FORMAT_VERSION}"); upgrade the editor.`,
    );
  }
  if (typeof o.name !== 'string' || o.name === '') {
    throw new Error('project.esproject must have a non-empty "name"');
  }
  const manifest: ProjectManifest = { formatVersion, name: o.name };
  if (typeof o.version === 'string') manifest.version = o.version;
  if (typeof o.engineBuildId === 'string') manifest.engineBuildId = o.engineBuildId;
  if (typeof o.defaultScene === 'string') manifest.defaultScene = o.defaultScene;
  if (typeof o.spineVersion === 'string') manifest.spineVersion = o.spineVersion;
  const dr = o.designResolution as { width?: unknown; height?: unknown } | undefined;
  if (dr && typeof dr.width === 'number' && typeof dr.height === 'number') {
    manifest.designResolution = { width: dr.width, height: dr.height };
  }
  if (o.layout && typeof o.layout === 'object') {
    manifest.layout = o.layout as Partial<ProjectLayout>;
  }
  if (o.scripts && typeof o.scripts === 'object') {
    const s = o.scripts as Record<string, unknown>;
    const scripts: ProjectScripts = {};
    if (typeof s.register === 'string') scripts.register = s.register;
    if (typeof s.main === 'string') scripts.main = s.main;
    if (scripts.register !== undefined || scripts.main !== undefined) manifest.scripts = scripts;
  }
  if (typeof o.description === 'string') manifest.description = o.description;
  if (typeof o.tag === 'string') manifest.tag = o.tag;
  if (o.features && typeof o.features === 'object') {
    const f = o.features as Record<string, unknown>;
    const features: ProjectFeatures = {};
    if (f.physics && typeof f.physics === 'object') {
      const p = f.physics as Record<string, unknown>;
      const physics: NonNullable<ProjectFeatures['physics']> = {};
      if (typeof p.enabled === 'boolean') physics.enabled = p.enabled;
      const g = p.gravity as { x?: unknown; y?: unknown } | undefined;
      if (g && typeof g.x === 'number' && typeof g.y === 'number') {
        physics.gravity = { x: g.x, y: g.y };
      }
      if (Array.isArray(p.collisionLayers)) {
        physics.collisionLayers = p.collisionLayers.slice(0, 16).map((n) => (typeof n === 'string' ? n : ''));
      }
      if (Array.isArray(p.collisionLayerMasks)) {
        physics.collisionLayerMasks = p.collisionLayerMasks.slice(0, 16)
          .map((n) => (typeof n === 'number' && Number.isFinite(n) ? n & 0xffff : 0xffff));
      }
      for (const k of ['fixedTimestep', 'subStepCount', 'contactHertz', 'contactDampingRatio', 'contactSpeed'] as const) {
        if (typeof p[k] === 'number' && Number.isFinite(p[k] as number)) physics[k] = p[k] as number;
      }
      if (typeof p.enableSleep === 'boolean') physics.enableSleep = p.enableSleep;
      if (typeof p.enableContinuous === 'boolean') physics.enableContinuous = p.enableContinuous;
      features.physics = physics;
    }
    if (f.rendering && typeof f.rendering === 'object') {
      const r = f.rendering as Record<string, unknown>;
      const rendering: NonNullable<ProjectFeatures['rendering']> = {};
      if (Array.isArray(r.sortingLayers)) {
        rendering.sortingLayers = r.sortingLayers.slice(0, 32).map((n) => (typeof n === 'string' ? n : ''));
      }
      if (Array.isArray(r.ySortLayers)) {
        rendering.ySortLayers = r.ySortLayers
          .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 32);
      }
      // Only 'linear' persists; 'gamma' (the default) is expressed by absence.
      if (r.colorSpace === 'linear') rendering.colorSpace = 'linear';
      // Camera fit — 'none' (off) is the default, expressed by absence.
      if (r.cameraScaleMode === 'fixed-width' || r.cameraScaleMode === 'fixed-height' ||
          r.cameraScaleMode === 'expand' || r.cameraScaleMode === 'shrink' || r.cameraScaleMode === 'match') {
        rendering.cameraScaleMode = r.cameraScaleMode;
      }
      if (typeof r.cameraMatch === 'number' && Number.isFinite(r.cameraMatch)) {
        rendering.cameraMatch = Math.min(1, Math.max(0, r.cameraMatch));
      }
      if (Object.keys(rendering).length > 0) features.rendering = rendering;
    }
    if (f.audio && typeof f.audio === 'object') {
      const audio = parseAudioProjectConfig(f.audio);
      if (audio.buses) features.audio = audio;
    }
    if (f.ui && typeof f.ui === 'object') {
      const u = f.ui as Record<string, unknown>;
      if (u.theme === 'light') features.ui = { theme: 'light' };
    }
    if (Object.keys(features).length > 0) manifest.features = features;
  }
  if (o.packaging && typeof o.packaging === 'object') {
    const p = o.packaging as Record<string, unknown>;
    const pkg: ProjectPackaging = {};
    if (p.platform === 'web' || p.platform === 'desktop' || p.platform === 'wechat' || p.platform === 'playable') pkg.platform = p.platform;
    if (p.config === 'development' || p.config === 'shipping') pkg.config = p.config;
    if (typeof p.sourceMaps === 'boolean') pkg.sourceMaps = p.sourceMaps;
    if (typeof p.openFolder === 'boolean') pkg.openFolder = p.openFolder;
    // Project-wide orientation. `orientation` is authoritative; a project written by
    // an older editor carried it per-platform (packaging.platforms.{wechat|playable}
    // .orientation) — hoist the first legacy value found (below) as a migration, then
    // it re-persists at the top level on the next write.
    let orientation: ScreenOrientation | undefined =
      p.orientation === 'portrait' || p.orientation === 'landscape' ? p.orientation : undefined;
    if (Array.isArray(p.excludeScenes)) {
      const ex = p.excludeScenes.filter((s): s is string => typeof s === 'string' && s !== '');
      if (ex.length > 0) pkg.excludeScenes = ex;
    }
    if (p.outDir && typeof p.outDir === 'object') {
      const od = p.outDir as Record<string, unknown>;
      const out: NonNullable<ProjectPackaging['outDir']> = {};
      for (const k of ['web', 'desktop', 'wechat', 'playable'] as const) {
        if (typeof od[k] === 'string') out[k] = od[k] as string;
      }
      if (Object.keys(out).length > 0) pkg.outDir = out;
    }
    if (p.platforms && typeof p.platforms === 'object') {
      const pl = p.platforms as Record<string, unknown>;
      const platforms: NonNullable<ProjectPackaging['platforms']> = {};
      const wx = pl.wechat as Record<string, unknown> | undefined;
      if (wx && typeof wx === 'object') {
        const w: WeChatPackaging = {};
        if (typeof wx.appid === 'string') w.appid = wx.appid;
        // Legacy per-platform orientation → the project-wide field (WeChat first).
        if (!orientation && (wx.orientation === 'portrait' || wx.orientation === 'landscape')) orientation = wx.orientation;
        if (Object.keys(w).length > 0) platforms.wechat = w;
      }
      const dt = pl.desktop as Record<string, unknown> | undefined;
      if (dt && typeof dt === 'object') {
        const d: DesktopPackaging = {};
        if (typeof dt.appId === 'string') d.appId = dt.appId;
        if (typeof dt.productName === 'string') d.productName = dt.productName;
        if (Object.keys(d).length > 0) platforms.desktop = d;
      }
      // Legacy playable.orientation (its only field) also migrates; the platform
      // block itself is gone (playable has no per-platform config anymore).
      const pa = pl.playable as Record<string, unknown> | undefined;
      if (!orientation && pa && typeof pa === 'object' && (pa.orientation === 'portrait' || pa.orientation === 'landscape')) {
        orientation = pa.orientation;
      }
      if (Object.keys(platforms).length > 0) pkg.platforms = platforms;
    }
    if (orientation) pkg.orientation = orientation;
    if (Object.keys(pkg).length > 0) manifest.packaging = pkg;
  }
  return manifest;
}

/** Effective layout = defaults overlaid with the manifest's overrides. */
export function resolveLayout(manifest: Pick<ProjectManifest, 'layout'>): ProjectLayout {
  return { ...DEFAULT_LAYOUT, ...(manifest.layout ?? {}) };
}

/** The orientation a design resolution implies: landscape when at least as wide as
 *  tall (matches the engine's 1920×1080 Canvas default), portrait otherwise. */
export function orientationFromDesignResolution(dr?: DesignResolution): ScreenOrientation {
  const width = dr?.width ?? 1920;
  const height = dr?.height ?? 1080;
  return width >= height ? 'landscape' : 'portrait';
}

/** Effective screen orientation for every export target: the explicit project
 *  setting when set, else derived from the design resolution's aspect. One value,
 *  read by WeChat/playable/web/desktop alike — the single source of truth. */
export function resolveOrientation(manifest: Pick<ProjectManifest, 'packaging' | 'designResolution'>): ScreenOrientation {
  return manifest.packaging?.orientation ?? orientationFromDesignResolution(manifest.designResolution);
}

/** cameraScaleMode → the engine's CanvasScaleMode value the runtime consumes
 *  (FixedWidth=0, FixedHeight=1, Expand=2, Shrink=3, Match=4), or -1 (SCREEN_FIT_OFF)
 *  for 'none'/absent — the camera keeps its raw orthoSize. Single-sourced here so the
 *  editor, the export config writers, and the play realm all map identically. */
export function cameraScaleModeValue(m: CameraScaleMode | undefined): number {
  switch (m) {
    case 'fixed-width': return 0;
    case 'fixed-height': return 1;
    case 'expand': return 2;
    case 'shrink': return 3;
    case 'match': return 4;
    default: return -1;
  }
}

/** The runtime screen-fit config (createWebApp `screenFit` / ScreenScaling) for a
 *  project: its design resolution + the mapped camera fit. `scaleMode` -1 ⇒ off. */
export function resolveScreenFit(manifest: Pick<ProjectManifest, 'designResolution' | 'features'>): {
  designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number;
} {
  const dr = manifest.designResolution;
  return {
    designWidth: dr?.width ?? 1920,
    designHeight: dr?.height ?? 1080,
    scaleMode: cameraScaleModeValue(manifest.features?.rendering?.cameraScaleMode),
    matchWidthOrHeight: manifest.features?.rendering?.cameraMatch ?? 0.5,
  };
}

/** Default script entries — the convention most projects follow without config. */
export const DEFAULT_SCRIPTS: Required<ProjectScripts> = {
  register: 'src/components.ts',
  main: 'src/main.ts',
};

/** Effective script entries = defaults overlaid with the manifest's overrides. */
export function resolveScripts(manifest: Pick<ProjectManifest, 'scripts'>): Required<ProjectScripts> {
  return { ...DEFAULT_SCRIPTS, ...(manifest.scripts ?? {}) };
}
