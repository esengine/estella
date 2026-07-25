// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The set of platforms this project can package for, and whether each one
 *        can actually run right now.
 *
 *        Two things the renderer cannot answer for itself:
 *
 *        1. READINESS. A target needs its engine runtime on disk; the dialog used
 *           to carry a static "requires the X runtime" line that showed whether or
 *           not you had built it — noise when you had, and a surprise mid-export
 *           when you hadn't. Readiness is a filesystem fact, so it is probed here.
 *
 *        2. PROJECT PLATFORMS. A game can ship a vendor the editor does not know
 *           about by dropping a profile in `.esengine/platforms/<id>.mjs`. Those
 *           modules export FUNCTIONS (emitConfigFiles / emitEntry), which cannot
 *           cross the IPC boundary — so the renderer gets metadata only, and the
 *           profile itself is loaded here, in the process that runs the export.
 *
 *        The mini-game family is what makes (2) cheap: the pipeline is already
 *        vendor-neutral (exportMiniGame), so a project platform is a data literal
 *        merged over MINIGAME_PROFILE_DEFAULTS, not a fork of anything.
 */
import { existsSync } from 'node:fs';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultMiniGameEntry } from './miniGameExportProfile';
import type { MiniGameExportProfile, MiniGameConfigContext } from './miniGameExportProfile';

/** Where a project keeps its own platform profiles. */
export const PROJECT_PLATFORM_DIR = path.join('.esengine', 'platforms');

/** Engine runtime dirs the probes look in (resolved by main.ts). */
export interface PlatformRuntimeDirs {
  /** Web/playable engine runtime (esengine.js + esengine.wasm). */
  web: string;
  /** WeChat engine runtime (esengine.wxgame.js + .wasm). */
  wechat: string;
}

/** What the renderer needs to draw one platform row. Serializable by construction. */
export interface PlatformStatus {
  id: string;
  /** 'builtin' rows get their label/icon/blurb from the editor's i18n; 'project'
   *  rows carry their own, since the project named them. */
  source: 'builtin' | 'project';
  /** The engine runtime this target needs is present. */
  ready: boolean;
  /** Present when `ready` is false. STRUCTURED, not prose: the main process has
   *  no locale, so it reports the facts and the renderer writes the sentence. */
  prereq?: {
    kind: 'runtime-missing';
    /** Display path that was searched (project-relative where possible). */
    dir: string;
    /** Glue filenames looked for in it. */
    looked: string[];
    /** The build command that produces it — only when the editor ships that target. */
    command?: string;
  };
  /** Project platforms only — display data lifted from the profile. */
  label?: string;
  blurb?: string;
  defaultOut?: string;
  /** Project platforms only — the module failed to load, and why. The row still
   *  appears (silently dropping a file the user wrote is worse than naming it). */
  error?: string;
}

// =============================================================================
// Built-in readiness
// =============================================================================

/** Display paths with forward slashes — the dialog shows them to a human, and a
 *  Windows `build\wasm\acme` reads worse than `build/wasm/acme`. */
const posix = (p: string): string => p.split(path.sep).join('/');

/** A built-in target's runtime dependency, as a real file probe. */
function builtinReadiness(id: string, dirs: PlatformRuntimeDirs): { ready: boolean; prereq?: PlatformStatus['prereq'] } {
  const has = (dir: string, file: string) => existsSync(path.join(dir, file));

  switch (id) {
    case 'web':
    case 'desktop':
      // The web payload's engine runtime ships with the editor.
      return has(dirs.web, 'esengine.js')
        ? { ready: true }
        : { ready: false, prereq: { kind: 'runtime-missing', dir: posix(dirs.web), looked: ['esengine.js'], command: 'node build-tools/cli.js build -t web' } };

    case 'playable':
      // Playable inlines the WEB runtime (exportPlayable reads esengine.js) — it
      // does NOT need a `-t playable` build, whatever the old static hint said.
      return has(dirs.web, 'esengine.js')
        ? { ready: true }
        : { ready: false, prereq: { kind: 'runtime-missing', dir: posix(dirs.web), looked: ['esengine.js'], command: 'node build-tools/cli.js build -t web' } };

    case 'wechat':
      return has(dirs.wechat, 'esengine.wxgame.js') || has(dirs.wechat, 'esengine.js')
        ? { ready: true }
        : { ready: false, prereq: { kind: 'runtime-missing', dir: posix(dirs.wechat), looked: ['esengine.wxgame.js'], command: 'node build-tools/cli.js build -t wechat' } };

    case 'native':
      // The native host is a C++ build with its own toolchain — not a file the
      // editor can stage, so this stays advisory rather than a probe.
      return { ready: true };

    default:
      return { ready: true };
  }
}

const BUILTIN_IDS = ['web', 'desktop', 'wechat', 'playable', 'native'] as const;

// =============================================================================
// Project platform profiles
// =============================================================================

/**
 * Everything a mini-game export profile needs when the project did not say.
 * Defaults describe a STANDARD host: the vendor-neutral SDK entry, the standard
 * `WebAssembly` engine glue, and the generic entry above. A project platform
 * that matches those supplies only `id`, `label` and `emitConfigFiles`.
 */
export const MINIGAME_PROFILE_DEFAULTS = {
  sdkEntryFile: 'index.minigame.js',
  runtimeInit: 'initMiniGameRuntime',
  engineGlueCandidates: ['esengine.js'] as readonly string[],
  esTarget: 'es2017' as const,
  wasmBuildHint: 'web',
  sideModuleBuildTargets: {} as Readonly<Record<string, string>>,
  nativeSuffixes: new Set(['.js', '.json']) as ReadonlySet<string>,
  binRestageExts: [] as readonly string[],
  subpackageDir: 'subpackages',
  emitEntry: defaultMiniGameEntry,
};

/** The shape a `.esengine/platforms/<id>.mjs` default-exports. */
export interface ProjectPlatformModule extends Partial<MiniGameExportProfile> {
  id: string;
  /** Shown in the platform list (the project names its own platforms). */
  label: string;
  blurb?: string;
  defaultOut?: string;
  /** Engine runtime dir for this platform, relative to the project root.
   *  Absent → the editor's web runtime. */
  wasmDir?: string;
  /**
   * Project-relative module whose default export is the RUNTIME
   * `MiniGameProfile`: `{ id, hostLabel, global }` plus any capability this
   * vendor replaces — its own video decoder, audio backend, socket or wasm
   * loader. The generated entry installs it before booting.
   *
   * This file is the packaging half of a vendor; that module is the runtime
   * half. Naming it here is what joins them.
   */
  runtimeProfile?: string;
  emitConfigFiles(ctx: MiniGameConfigContext): Array<{ file: string; content: string }>;
}

/** A loaded project platform: the export profile plus where its runtime lives. */
export interface ProjectPlatform {
  profile: MiniGameExportProfile;
  /** Absolute runtime dir, resolved from the module's `wasmDir` or the web default. */
  wasmDir: string;
  defaultOut: string;
}

function platformDir(root: string): string {
  return path.join(root, PROJECT_PLATFORM_DIR);
}

// =============================================================================
// Scaffolding
// =============================================================================

/** Where the generated runtime half goes, relative to the project root. */
const runtimeHalfPath = (scriptsDir: string, id: string): string =>
  path.join(scriptsDir, 'platforms', `${id}.runtime.ts`);

/** The packaging half — data plus the one emitter a vendor must write. */
function packagingTemplate(id: string, label: string, runtimeRel: string): string {
  return `// Packaging profile for "${label}" — how Estella builds the package.
//
// This is one half of a platform. The other half (${runtimeRel}) describes the
// HOST at runtime, and is where you replace a capability: your own video
// decoder, audio backend, socket or wasm loader.
//
// Everything not set here defaults to a standard mini-game host, so this file
// only carries what is genuinely yours.
export default {
  id: '${id}',
  label: '${label}',
  blurb: '${label} package.',
  defaultOut: 'dist-${id}',

  // Joins the two halves: the generated entry installs this profile before boot.
  runtimeProfile: '${runtimeRel.split(path.sep).join('/')}',

  // TODO: emit the config files your host's packer expects. The context carries
  // the vendor-neutral facts the pipeline computed.
  emitConfigFiles(ctx) {
    return [
      {
        file: 'game.json',
        content: JSON.stringify(
          {
            appName: ctx.title,
            orientation: ctx.orientation,
            // Lazy asset groups become the host's subpackage roots.
            ...(ctx.subPackages.length > 0 ? { subPackages: ctx.subPackages } : {}),
          },
          null,
          2,
        ) + '\\n',
      },
    ];
  },

  // Uncomment if your host needs its own engine build; the default is the
  // editor's web runtime.
  // wasmDir: 'build/wasm/${id}',
};
`;
}

/** The runtime half — the host global, plus anything this vendor replaces. */
function runtimeTemplate(id: string, label: string): string {
  return `// Runtime profile for "${label}" — what the host is, at run time.
//
// Three facts are all that is required. Everything a mini-game host shares —
// filesystem, fetch, canvas, image decode, touch/key input, storage,
// subpackages, audio, sockets, video — comes from the global below.
import type { MiniGameProfile } from 'esengine/minigame';

// TODO: point this at your host's global API object (the wx-shaped one).
declare const HOST_GLOBAL: unknown;

const profile: MiniGameProfile = {
  id: '${id}',
  hostLabel: '${label}',

  // Read through a getter: the host global only exists at run time, so importing
  // this file in a bundler or a test must not touch it.
  get global() {
    if (typeof HOST_GLOBAL === 'undefined') {
      throw new Error('[${id}] set \`global\` in this file to your host API object');
    }
    return HOST_GLOBAL as MiniGameProfile['global'];
  },

  // ---------------------------------------------------------------------------
  // Optional overrides. Write one ONLY where your host genuinely differs, or
  // where you want a different implementation than the engine's.
  // ---------------------------------------------------------------------------

  // Your host does not use the standard \`WebAssembly\` (WeChat, for one, routes
  // through WXWebAssembly and takes a package path rather than bytes):
  // instantiateWasm(pathOrBuffer, imports) { … },

  // Your own video decoding, instead of the engine's wasm MPEG-1 decoder:
  // createVideoBackend(ctx) { return new MySoftwareDecoder(ctx); },

  // Your own audio or socket transport, instead of the family defaults built on
  // the host global:
  // createAudioBackend() { return new MyAudioBackend(); },
  // createSocket(options) { return new MySocket(options); },
};

export default profile;
`;
}

export interface CreatePlatformResult {
  ok: boolean;
  error?: string;
  /** Project-relative paths of the two files written. */
  packagingFile?: string;
  runtimeFile?: string;
}

/**
 * Scaffold a project platform: both halves, already joined.
 *
 * The editor writes them rather than asking the developer to create files by
 * hand — the shape of a vendor (two files, linked by `runtimeProfile`) is
 * exactly the thing that is hard to know before you have seen one.
 */
export async function createProjectPlatform(
  root: string,
  id: string,
  label: string,
  scriptsDir: string,
): Promise<CreatePlatformResult> {
  const bad = idProblem(id);
  if (bad) return { ok: false, error: bad };
  if (!label.trim()) return { ok: false, error: 'platform needs a label' };

  const packagingRel = path.join(PROJECT_PLATFORM_DIR, `${id}.mjs`);
  const runtimeRel = runtimeHalfPath(scriptsDir, id);
  const packagingAbs = path.join(root, packagingRel);
  const runtimeAbs = path.join(root, runtimeRel);

  if (existsSync(packagingAbs)) return { ok: false, error: `${packagingRel} already exists` };

  try {
    await mkdir(path.dirname(packagingAbs), { recursive: true });
    await mkdir(path.dirname(runtimeAbs), { recursive: true });
    await writeFile(packagingAbs, packagingTemplate(id, label, runtimeRel), 'utf8');
    // Never clobber a runtime half the developer already wrote.
    if (!existsSync(runtimeAbs)) await writeFile(runtimeAbs, runtimeTemplate(id, label), 'utf8');
    return { ok: true, packagingFile: posix(packagingRel), runtimeFile: posix(runtimeRel) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Ids that would collide with a built-in, or that are unsafe as a directory name. */
function idProblem(id: unknown): string | null {
  if (typeof id !== 'string' || id.length === 0) return 'profile has no string `id`';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return `id "${id}" must be lowercase letters, digits and dashes`;
  if ((BUILTIN_IDS as readonly string[]).includes(id)) return `id "${id}" is a built-in platform`;
  return null;
}

/**
 * Import one project platform module. Returns its raw export, or an error string
 * — never throws: a project that ships a broken profile must still be able to
 * open the dialog and package for every other target.
 */
async function importPlatformModule(file: string): Promise<{ mod?: ProjectPlatformModule; error?: string }> {
  try {
    // Cache-busted so editing the profile and re-opening the dialog picks it up
    // without restarting the editor.
    const url = `${pathToFileURL(file).href}?t=${Date.now()}`;
    const ns = (await import(/* @vite-ignore */ url)) as { default?: unknown };
    const mod = ns.default;
    if (!mod || typeof mod !== 'object') return { error: 'module has no default export object' };
    const candidate = mod as ProjectPlatformModule;
    const bad = idProblem(candidate.id);
    if (bad) return { error: bad };
    if (typeof candidate.label !== 'string' || !candidate.label) return { error: 'profile has no `label`' };
    if (typeof candidate.emitConfigFiles !== 'function') return { error: 'profile has no `emitConfigFiles(ctx)`' };
    return { mod: candidate };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Every `.mjs` under the project's platform dir, sorted for a stable list. */
async function projectPlatformFiles(root: string): Promise<string[]> {
  const dir = platformDir(root);
  if (!existsSync(dir)) return [];
  try {
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith('.mjs')).sort().map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

/**
 * Load the project platform with this id, merged over the family defaults and
 * ready to hand to {@link exportMiniGame}. Null when there is no such platform.
 */
export async function loadProjectPlatform(root: string, id: string, dirs: PlatformRuntimeDirs): Promise<ProjectPlatform | null> {
  for (const file of await projectPlatformFiles(root)) {
    const { mod } = await importPlatformModule(file);
    if (!mod || mod.id !== id) continue;
    // The runtime half is resolved to an absolute path here: the generated entry
    // is bundled with `resolveDir` at the project root, but an absolute specifier
    // is unambiguous whatever the profile wrote.
    const runtimeProfileModule = mod.runtimeProfile
      ? (path.isAbsolute(mod.runtimeProfile) ? mod.runtimeProfile : path.join(root, mod.runtimeProfile))
      : undefined;
    const profile = { ...MINIGAME_PROFILE_DEFAULTS, ...mod, runtimeProfileModule } as MiniGameExportProfile;
    const wasmDir = mod.wasmDir
      ? (path.isAbsolute(mod.wasmDir) ? mod.wasmDir : path.join(root, mod.wasmDir))
      : dirs.web;
    return { profile, wasmDir, defaultOut: mod.defaultOut ?? `dist-${id}` };
  }
  return null;
}

// =============================================================================
// The catalog
// =============================================================================

/**
 * Every platform this project can target, built-ins first, then the project's
 * own — each with its readiness probed.
 */
export async function listPlatforms(root: string | null, dirs: PlatformRuntimeDirs): Promise<PlatformStatus[]> {
  const out: PlatformStatus[] = BUILTIN_IDS.map((id) => ({
    id,
    source: 'builtin' as const,
    ...builtinReadiness(id, dirs),
  }));

  if (!root) return out;

  for (const file of await projectPlatformFiles(root)) {
    const { mod, error } = await importPlatformModule(file);
    if (error || !mod) {
      out.push({
        id: path.basename(file, '.mjs'),
        source: 'project',
        ready: false,
        label: path.basename(file),
        error,
      });
      continue;
    }
    const wasmDir = mod.wasmDir
      ? (path.isAbsolute(mod.wasmDir) ? mod.wasmDir : path.join(root, mod.wasmDir))
      : dirs.web;
    // A runtime half that points nowhere is caught here rather than on a device:
    // the export would bundle fine and then fail to resolve the import.
    if (mod.runtimeProfile) {
      const abs = path.isAbsolute(mod.runtimeProfile) ? mod.runtimeProfile : path.join(root, mod.runtimeProfile);
      if (![abs, `${abs}.ts`, `${abs}.js`, `${abs}.mjs`].some(existsSync)) {
        out.push({
          id: mod.id,
          source: 'project',
          ready: false,
          label: mod.label,
          error: `runtimeProfile "${mod.runtimeProfile}" does not exist`,
        });
        continue;
      }
    }
    const glues = mod.engineGlueCandidates ?? MINIGAME_PROFILE_DEFAULTS.engineGlueCandidates;
    const ready = glues.some((g) => existsSync(path.join(wasmDir, g)));
    out.push({
      id: mod.id,
      source: 'project',
      ready,
      label: mod.label,
      blurb: mod.blurb,
      defaultOut: mod.defaultOut ?? `dist-${mod.id}`,
      prereq: ready
        ? undefined
        // No command: the editor does not know how this project builds its own
        // engine runtime, so it reports where it looked and stops there.
        : { kind: 'runtime-missing', dir: posix(path.relative(root, wasmDir) || wasmDir), looked: [...glues] },
    });
  }

  return out;
}
