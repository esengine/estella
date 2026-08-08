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

import { parseAudioProjectConfig, THEME_COLOR_ROLES, type AudioProjectConfig } from 'esengine';
import { normalizePlatform, type ExportPlatform } from './platforms';

export const PROJECT_FORMAT_VERSION = '1';
export const PROJECT_MANIFEST_FILE = 'project.esproject';
export const WORKSPACE_DIR = '.esengine';
export const WORKSPACE_FILE = 'workspace.json';

/**
 * Nameable render sorting layers. 32 because y-sort is a 32-bit mask over layer
 * indices (DrawList::setYSortMask) — a layer past 31 could be named but never
 * y-sorted. The renderer itself takes any i32 as a `layer`; this bounds only the
 * NAMED slots, and an unnamed project keeps a free-number `layer` field.
 */
export const SORTING_LAYER_COUNT = 32;

/**
 * The stored form of a sorting-layer list: the settings control always hands back
 * a full-width list, most of it empty, but a slot's meaning is its INDEX, so only
 * trailing empties are droppable — an empty slot between two named ones is a real
 * z-order gap and must survive. An all-empty list stores as nothing at all.
 */
export function trimSortingLayers(names: readonly string[]): string[] {
  const out = names.slice(0, SORTING_LAYER_COUNT).map((n) => (typeof n === 'string' ? n : ''));
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

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
 * A screen the project cares about testing on, shown in the viewport/Game
 * target-screen dropdown alongside the built-in devices.
 *
 * Which handsets a team ships to is a property of the PROJECT, not of the
 * editor: a built-in list can only ever be a guess, and a guess that cannot be
 * corrected means everyone tests on approximately the wrong screen. Dimensions
 * are stored portrait (w ≤ h) like the built-ins, so the orientation toggle
 * means the same thing for both.
 */
export interface ScreenPreset {
  /** Stable id — what the editor's device selection persists. */
  id: string;
  label: string;
  width: number;
  height: number;
  /** Safe-area insets in device pixels (notch / home indicator), if any. */
  safe?: { top: number; bottom: number; left: number; right: number };
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
    /** Indices of sorting layers that resolve by real depth instead of painter's
     *  order — the 2.5D opt-in. A layer listed in both keeps y-sorting. */
    depthLayers?: number[];
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
    /** Partial re-skin over the base theme: color role → #rrggbbaa hex. Only
     *  known roles with valid hex persist; absence means "inherit the base". */
    colors?: Record<string, string>;
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
export interface DesktopPackaging {
  appId?: string;
  productName?: string;
  /**
   * Where this build goes. A CHANNEL, not a platform: Steam defines no runtime and
   * no asset format, only a depot layout, a set of services and an upload — so it
   * rides the desktop target the way an ad network rides the playable one
   * (docs/REARCH_STEAM.md §1). Absent ⇒ standalone: just the app.
   */
  channel?: 'standalone' | 'steam';
  steam?: SteamPackaging;
}

/** What only Valve can tell you, kept so a build can write its own scripts. */
export interface SteamPackaging {
  /** The application id from the partner backend. Without it nothing is emitted:
   *  a depot script with a guessed appid uploads to someone else's game or, more
   *  likely, to nothing at all. */
  appId?: number;
  /** Depot ids per OS. Valve assigns these; absent ⇒ `appId + 1`, …, which the
   *  generated checklist tells you to check rather than trust. */
  depots?: Partial<Record<'macos' | 'windows' | 'linux', number>>;
  /** Build description shown in the backend's build list. */
  description?: string;
}

/** Android's slice of the app identity. `appId` is the manifest package — the
 *  identity a store keeps forever; `versionCode` is the integer Play orders builds
 *  by, which has no counterpart on any other target. */
export interface AndroidPackaging {
  appId?: string;
  versionCode?: number;
  /**
   * What the export produces: the installable package, or an Android Studio
   * project the game is built from.
   *
   * A package is the shorter path and needs nothing installed; a project is the
   * only one that can carry an SDK, a permission or an Activity of the game's own
   * — the same choice the iOS export makes for you, made explicit here because
   * Android can do both.
   */
  output?: 'package' | 'project';
  /**
   * Also write the Google Play upload format (`.aab`) beside the `.apk`.
   *
   * Off by default because the two are for different moments: the APK is what
   * installs on a device you are holding, the bundle is what a store takes and
   * cannot be installed at all. Producing both on every iteration would double the
   * output for the one that is not being used.
   */
  appBundle?: boolean;
}
/** iOS's slice: the bundle identifier Xcode signs against. */
export interface IosPackaging { appId?: string; }

/** Playable's slice: which ad network the single-file package targets. The id names
 *  a profile — one the editor ships, or one the project defines in
 *  `.esengine/platforms/<id>.mjs` with `kind: 'playable'` — which decides the size
 *  cap, the `<head>` markup, and the API `playableCta()` calls. Absent ⇒ generic
 *  (no network API, strictest cap). */
export interface PlayablePackaging { network?: string; }

/** A packaging target — defined in `./platforms`, where the built-in vocabulary
 *  lives, and re-exported here because the manifest is what persists it. */
export type { ExportPlatform } from './platforms';

/** Persisted Package Project settings (UE's ProjectPackagingSettings analog) —
 *  committed with the project so the build dialog restores the last target/config
 *  and the export reads per-platform config. */
export interface ProjectPackaging {
  platform?: ExportPlatform;
  config?: 'development' | 'shipping';
  sourceMaps?: boolean;
  openFolder?: boolean;
  /** Screen orientation for EVERY export target (WeChat game.json deviceOrientation,
   *  the web/playable rotate-to-fit hint, the desktop window's aspect). Absent ⇒
   *  derived from the design resolution's aspect (see {@link resolveOrientation}) —
   *  so a landscape design ships landscape with zero config. */
  orientation?: ScreenOrientation;
  /**
   * How the build treats asset optimization. `'auto'` (default) honors each
   * asset's per-asset Import Settings — textures compress to KTX2 / downscale to
   * their Max Size, WAV → MP3, `<name>.atlas/` folders pack — so what ships is
   * authored on the asset, not toggled here. `'skip'` ships everything raw for
   * fast iteration (Unity's "Asset Import Overrides"). The build derives the cook
   * flags below from this; the per-ASSET decisions live in the Inspector.
   */
  assetCompression?: 'auto' | 'skip';
  /** @deprecated Superseded by {@link assetCompression}. Kept so older projects
   *  still parse; the dialog no longer writes these. */
  compressTextures?: boolean;
  /** @deprecated see {@link assetCompression}. */
  compressAudio?: boolean;
  /** @deprecated see {@link assetCompression}. */
  atlasTextures?: boolean;
  /** Project-relative scene paths NOT shipped as switchable scenes (dev/test
   *  scenes). Everything else under the scenes dir exports; the startup scene
   *  always ships regardless. */
  excludeScenes?: string[];
  /** Per-platform output-dir overrides (else the per-platform default). */
  outDir?: Partial<Record<ExportPlatform, string>>;
  /**
   * Per-platform package-size ceiling, in BYTES — what the build is judged
   * against instead of the limit the target declares for itself.
   *
   * Two teams need this for opposite reasons: one ships well under WeChat's 4MB
   * and wants to be told before it creeps up, the other targets a host whose cap
   * we do not know. Both are more authoritative about their own build than a
   * built-in number is. Absent ⇒ the target's own limit, if it has one (see
   * `sizeBudget.ts`).
   */
  sizeBudget?: Partial<Record<ExportPlatform, number>>;
  /**
   * The application identifier (reverse-DNS) every installable target needs: the
   * Android manifest package, the iOS bundle id, the Electron appId. One project
   * ships as one application, so it is declared once here; a target that genuinely
   * differs overrides it below, the way a texture's Import Settings have a default
   * and per-platform overrides.
   *
   * Absent ⇒ derived from the project name (see {@link resolveAppId}), so a build
   * always has one — but a shipped app should say its own.
   */
  appId?: string;
  /**
   * The app's launcher icon: a project-relative square PNG, ideally 1024×1024.
   *
   * ONE image for every installable target — Android takes it as the launcher
   * mipmap, iOS as the asset catalog Xcode derives every size from. Nothing
   * resizes it: both platforms scale, and a per-density set would be five files to
   * keep in sync for a picture that is the same picture. Absent ⇒ Estella's own
   * mark, so a packaged game never ships with the platform's placeholder.
   */
  icon?: string;
  /**
   * The achievements this game has, by id.
   *
   * Platform-NEUTRAL rather than under a store, because every store has this same
   * list under a different name. Declaring them lets the runtime refuse an unlock
   * a store would accept and silently drop.
   */
  achievements?: string[];
  /** Per-platform packaging config: each target's slice of the app identity, plus
   *  whatever only it has (a WeChat appid, an Android versionCode). */
  platforms?: {
    wechat?: WeChatPackaging;
    desktop?: DesktopPackaging;
    android?: AndroidPackaging;
    ios?: IosPackaging;
    playable?: PlayablePackaging;
  };
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
  /** Extra screens the target-screen dropdown offers, beside the built-in devices. */
  screenPresets?: ScreenPreset[];
  /** Spine runtime the project needs ('none' | '2.1' | '3.8' | '4.1' | '4.2' | '4.3' …). */
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
  if (Array.isArray(o.screenPresets)) {
    // Hand-edited manifests are normal, so a malformed entry is dropped rather
    // than failing the load — a bad preset must not cost you the project.
    const presets = (o.screenPresets as unknown[]).flatMap((raw) => {
      const p = raw as Partial<ScreenPreset> | null;
      if (!p || typeof p.id !== 'string' || typeof p.label !== 'string') return [];
      if (typeof p.width !== 'number' || typeof p.height !== 'number') return [];
      if (!(p.width > 0) || !(p.height > 0)) return [];
      const out: ScreenPreset = { id: p.id, label: p.label, width: p.width, height: p.height };
      const s = p.safe;
      if (s && [s.top, s.bottom, s.left, s.right].every((n) => typeof n === 'number')) out.safe = s;
      return [out];
    });
    if (presets.length > 0) manifest.screenPresets = presets;
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
        rendering.sortingLayers = r.sortingLayers
          .slice(0, SORTING_LAYER_COUNT)
          .map((n) => (typeof n === 'string' ? n : ''));
      }
      if (Array.isArray(r.ySortLayers)) {
        rendering.ySortLayers = r.ySortLayers.filter(
          (n): n is number =>
            typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < SORTING_LAYER_COUNT,
        );
      }
      if (Array.isArray(r.depthLayers)) {
        rendering.depthLayers = r.depthLayers.filter(
          (n): n is number =>
            typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < SORTING_LAYER_COUNT,
        );
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
      const ui: NonNullable<ProjectFeatures['ui']> = {};
      if (u.theme === 'light') ui.theme = 'light';
      if (u.colors && typeof u.colors === 'object') {
        const colors: Record<string, string> = {};
        for (const role of THEME_COLOR_ROLES) {
          const v = (u.colors as Record<string, unknown>)[role];
          if (typeof v === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(v)) colors[role] = v.toLowerCase();
        }
        if (Object.keys(colors).length > 0) ui.colors = colors;
      }
      if (Object.keys(ui).length > 0) features.ui = ui;
    }
    if (Object.keys(features).length > 0) manifest.features = features;
  }
  if (o.packaging && typeof o.packaging === 'object') {
    const p = o.packaging as Record<string, unknown>;
    const pkg: ProjectPackaging = {};
    // Any non-empty id: built-ins plus whatever platforms the project defines.
    // (The old enumeration silently dropped unknown ids, so packaging for them
    // never persisted and the dialog reopened on web.) `normalizePlatform` is the
    // one migration point: an id an older editor wrote — 'native', when the two
    // mobile targets were one row — becomes the id this editor spells.
    if (typeof p.platform === 'string' && p.platform !== '') pkg.platform = normalizePlatform(p.platform);
    if (p.config === 'development' || p.config === 'shipping') pkg.config = p.config;
    if (typeof p.appId === 'string' && p.appId !== '') pkg.appId = p.appId;
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
      // Per-platform output dirs, keyed by whatever platform ids this project has
      // used — built-in or its own. A renamed built-in keeps its directory: the
      // key migrates, the value the developer chose does not.
      for (const [k, v] of Object.entries(od)) {
        if (typeof v === 'string' && v !== '') out[normalizePlatform(k)] = v;
      }
      if (Object.keys(out).length > 0) pkg.outDir = out;
    }
    // Per-platform size ceilings, keyed the same way the output dirs are. A
    // non-positive or unreadable value is DROPPED rather than carried as zero:
    // the field's absence means "judge this target by its own limit", and a 0
    // that survived would mean every build is infinitely over budget.
    if (p.sizeBudget && typeof p.sizeBudget === 'object') {
      const sb = p.sizeBudget as Record<string, unknown>;
      const budgets: NonNullable<ProjectPackaging['sizeBudget']> = {};
      for (const [k, v] of Object.entries(sb)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) budgets[normalizePlatform(k)] = v;
      }
      if (Object.keys(budgets).length > 0) pkg.sizeBudget = budgets;
    }
    // Deduplicated and trimmed: a store keys achievements by this string, so a
    // stray blank or a repeat is a row that can never match one.
    if (Array.isArray(p.achievements)) {
      const ids = [...new Set(p.achievements
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean))];
      if (ids.length > 0) pkg.achievements = ids;
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
        if (dt.channel === 'steam' || dt.channel === 'standalone') d.channel = dt.channel;
        const st = dt.steam as Record<string, unknown> | undefined;
        if (st && typeof st === 'object') {
          const steam: SteamPackaging = {};
          // A non-integer or non-positive appid is not a typo to carry forward:
          // every script written from it would name a game that is not this one.
          if (typeof st.appId === 'number' && Number.isInteger(st.appId) && st.appId > 0) {
            steam.appId = st.appId;
          }
          if (typeof st.description === 'string') steam.description = st.description;
          const dp = st.depots as Record<string, unknown> | undefined;
          if (dp && typeof dp === 'object') {
            const depots: NonNullable<SteamPackaging['depots']> = {};
            for (const os of ['macos', 'windows', 'linux'] as const) {
              const id = dp[os];
              if (typeof id === 'number' && Number.isInteger(id) && id > 0) depots[os] = id;
            }
            if (Object.keys(depots).length > 0) steam.depots = depots;
          }
          if (Object.keys(steam).length > 0) d.steam = steam;
        }
        if (Object.keys(d).length > 0) platforms.desktop = d;
      }
      const an = pl.android as Record<string, unknown> | undefined;
      if (an && typeof an === 'object') {
        const a: AndroidPackaging = {};
        if (typeof an.appId === 'string') a.appId = an.appId;
        if (typeof an.versionCode === 'number' && Number.isInteger(an.versionCode) && an.versionCode > 0) {
          a.versionCode = an.versionCode;
        }
        if (Object.keys(a).length > 0) platforms.android = a;
      }
      const io = pl.ios as Record<string, unknown> | undefined;
      if (io && typeof io === 'object') {
        const i: IosPackaging = {};
        if (typeof io.appId === 'string') i.appId = io.appId;
        if (Object.keys(i).length > 0) platforms.ios = i;
      }
      const pa = pl.playable as Record<string, unknown> | undefined;
      if (pa && typeof pa === 'object') {
        // A legacy playable.orientation migrates to the project-wide field; `network`
        // is what the block carries today.
        if (!orientation && (pa.orientation === 'portrait' || pa.orientation === 'landscape')) {
          orientation = pa.orientation;
        }
        const p: PlayablePackaging = {};
        if (typeof pa.network === 'string' && pa.network !== '') p.network = pa.network;
        if (Object.keys(p).length > 0) platforms.playable = p;
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

/**
 * A reverse-DNS application id derived from the project name — the last-resort
 * default, so a build always has one to sign. Non-alphanumerics collapse to a
 * single dot-safe segment, and a leading digit is prefixed (a Java package
 * segment cannot start with one, which is what Android checks).
 */
export function appIdFromName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '')
    || 'game';
  return `com.estella.${/^\d/.test(slug) ? `a${slug}` : slug}`;
}

/**
 * The application id a target ships under: the platform's own override, else the
 * project-wide one, else derived from the project name. One rule, so the editor's
 * settings page, the exporter and the packagers cannot disagree about a project's
 * identity.
 */
export function resolveAppId(
  manifest: Pick<ProjectManifest, 'name' | 'packaging'>,
  platform: 'android' | 'ios' | 'desktop',
): string {
  const platforms = manifest.packaging?.platforms;
  const override = platform === 'android' ? platforms?.android?.appId
    : platform === 'ios' ? platforms?.ios?.appId
      : platforms?.desktop?.appId;
  return override || manifest.packaging?.appId || appIdFromName(manifest.name);
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
