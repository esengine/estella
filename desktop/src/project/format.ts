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
  };
}

export type ScreenOrientation = 'portrait' | 'landscape';
/** Per-platform packaging config (the platform-specific Project Settings pages). */
export interface WeChatPackaging { appid?: string; orientation?: ScreenOrientation; }
export interface DesktopPackaging { appId?: string; productName?: string; }
export interface PlayablePackaging { orientation?: ScreenOrientation; }

/** Persisted Package Project settings (UE's ProjectPackagingSettings analog) —
 *  committed with the project so the build dialog restores the last target/config
 *  and the export reads per-platform config. */
export interface ProjectPackaging {
  platform?: 'web' | 'desktop' | 'wechat' | 'playable';
  config?: 'development' | 'shipping';
  sourceMaps?: boolean;
  openFolder?: boolean;
  /** Per-platform output-dir overrides (else the per-platform default). */
  outDir?: Partial<Record<'web' | 'desktop' | 'wechat' | 'playable', string>>;
  /** Per-platform packaging config (appid, app id, orientation, …). */
  platforms?: { wechat?: WeChatPackaging; desktop?: DesktopPackaging; playable?: PlayablePackaging };
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
  description?: string;
  tag?: string;
  thumbnail?: string;
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
      if (Array.isArray(r.sortingLayers)) {
        features.rendering = { sortingLayers: r.sortingLayers.slice(0, 32).map((n) => (typeof n === 'string' ? n : '')) };
      }
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
        if (wx.orientation === 'portrait' || wx.orientation === 'landscape') w.orientation = wx.orientation;
        if (Object.keys(w).length > 0) platforms.wechat = w;
      }
      const dt = pl.desktop as Record<string, unknown> | undefined;
      if (dt && typeof dt === 'object') {
        const d: DesktopPackaging = {};
        if (typeof dt.appId === 'string') d.appId = dt.appId;
        if (typeof dt.productName === 'string') d.productName = dt.productName;
        if (Object.keys(d).length > 0) platforms.desktop = d;
      }
      const pa = pl.playable as Record<string, unknown> | undefined;
      if (pa && typeof pa === 'object') {
        const a: PlayablePackaging = {};
        if (pa.orientation === 'portrait' || pa.orientation === 'landscape') a.orientation = pa.orientation;
        if (Object.keys(a).length > 0) platforms.playable = a;
      }
      if (Object.keys(platforms).length > 0) pkg.platforms = platforms;
    }
    if (Object.keys(pkg).length > 0) manifest.packaging = pkg;
  }
  return manifest;
}

/** Effective layout = defaults overlaid with the manifest's overrides. */
export function resolveLayout(manifest: Pick<ProjectManifest, 'layout'>): ProjectLayout {
  return { ...DEFAULT_LAYOUT, ...(manifest.layout ?? {}) };
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

/** A fresh manifest for `new project`. */
export function defaultManifest(name: string): ProjectManifest {
  return { formatVersion: PROJECT_FORMAT_VERSION, name, defaultScene: 'assets/scenes/main.esscene' };
}
