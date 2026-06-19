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
  /** One-line summary, shown when the project is used as a New-project template. */
  description?: string;
  /** Short category label for the template gallery (e.g. "2D", "Physics"). */
  tag?: string;
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
  if (typeof o.description === 'string') manifest.description = o.description;
  if (typeof o.tag === 'string') manifest.tag = o.tag;
  return manifest;
}

/** Effective layout = defaults overlaid with the manifest's overrides. */
export function resolveLayout(manifest: Pick<ProjectManifest, 'layout'>): ProjectLayout {
  return { ...DEFAULT_LAYOUT, ...(manifest.layout ?? {}) };
}

/** A fresh manifest for `new project`. */
export function defaultManifest(name: string): ProjectManifest {
  return { formatVersion: PROJECT_FORMAT_VERSION, name, defaultScene: 'assets/scenes/main.esscene' };
}
