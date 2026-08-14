// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The main-process half of the editor plugin system: find plugins, compile
 *        their entry, and remember which ones the user trusted or disabled.
 *
 * Three things the renderer cannot do for itself:
 *
 *  1. DISCOVERY. Plugins live on disk in four scopes — inside the project
 *     (`.esengine/plugins/`, versioned with it, shared by the team), installed
 *     from npm (a direct dependency shipping a `plugin.json`), per-user
 *     (`<userData>/plugins/`, personal tools across projects), and the ones the
 *     editor ships with. On an id collision the higher-priority scope wins and
 *     the shadowed one is REPORTED rather than dropped — which is also how a
 *     project replaces a shipped plugin with its own build of it.
 *
 *  2. COMPILATION. Authors write ESM TypeScript with no build step; esbuild turns
 *     the entry into one CJS module through the same single door the project-script
 *     bundler uses (esbuildRuntime, which handles the packaged-asar binary path).
 *     Output is returned in memory and NOT cached: a small plugin compiles in
 *     milliseconds, and a cache here would only buy that back in exchange for the
 *     entire stale-artifact bug class — reload has to be exactly right for hot
 *     reload to be trustworthy.
 *
 *  3. TRUST. A renderer plugin runs in the editor's own realm, so loading one is a
 *     decision only the user can make. The record itself lives in pluginTrust.ts,
 *     shared with the platform catalog so every kind of project-supplied code
 *     passes one gate.
 *
 * Pure Node apart from the userData path (injected), so it stays unit-testable.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEsbuild } from './esbuildRuntime';
import { validateManifest, type PluginManifest } from '../src/plugins/manifest';
import { PROJECT_PLUGIN_REL } from '../src/plugins/paths';
import { PROJECT_PLATFORM_DIR, platformTrustId } from './platformCatalog';

/** Where a project keeps its own plugins (sibling of `.esengine/platforms/`),
 *  resolved to this OS's separator from the one shared spelling. */
export const PROJECT_PLUGIN_DIR = path.join(...PROJECT_PLUGIN_REL.split('/'));
/** Per-user plugin folder name, under Electron's userData. */
export const USER_PLUGIN_DIR = 'plugins';

/** Which scope a plugin was found in. On an id collision the first of
 *  project → package → user → builtin wins, and the others say who took it. */
export type PluginScope = 'project' | 'package' | 'user' | 'builtin';

/**
 * What kind of project-supplied code an entry is.
 *  - `plugin` — a folder with a plugin.json, compiled and run in the renderer.
 *  - `project-platform` — a `.esengine/platforms/<id>.mjs` packaging profile,
 *    imported into the MAIN process by the export pipeline. It has no activation
 *    of its own; listing it here is what puts it behind the same trust gate and in
 *    the same "what is this project asking the editor to run?" list.
 */
export type PluginKind = 'plugin' | 'project-platform';

/** What the renderer needs to list one plugin. Serializable by construction. */
export interface DiscoveredPlugin {
  id: string;
  kind: PluginKind;
  scope: PluginScope;
  /** Absolute plugin folder — shown in the UI and opened by "Reveal". For a
   *  project platform, the profile FILE (it has no folder of its own). */
  dir: string;
  /** Present when the manifest parsed and validated. */
  manifest?: PluginManifest;
  /** Present when it did not: the reason, so a broken plugin is named not hidden. */
  error?: string;
  /** Set when a same-id plugin in a higher-priority scope took precedence. */
  shadowedBy?: PluginScope;
}

export interface CompiledPlugin {
  ok: boolean;
  /** CJS module text, loaded by the renderer through an injected `require`. */
  code?: string;
  errors: string[];
  warnings: string[];
}

// The host provides these; a plugin bundling its own copy would mean two Reacts
// (broken hooks) or two SDK instances (two component registries).
const EDITOR_EXTERNALS = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@estella/editor-api', 'esengine'];

// =============================================================================
// Discovery
// =============================================================================

/** One plugin folder read into a record. `fallbackId` names it while the manifest
 *  cannot: an unreadable plugin still has to appear, carrying the reason. */
const NO_MANIFEST = 'folder has no plugin.json';

async function readOnePlugin(pluginDir: string, scope: PluginScope, fallbackId: string): Promise<DiscoveredPlugin> {
  const base = { kind: 'plugin' as const, scope, dir: pluginDir };
  const manifestFile = path.join(pluginDir, 'plugin.json');
  if (!existsSync(manifestFile)) return { ...base, id: fallbackId, error: NO_MANIFEST };
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
    const result = validateManifest(parsed);
    return 'error' in result
      ? { ...base, id: fallbackId, error: result.error }
      : { ...base, id: result.manifest.id, manifest: result.manifest };
  } catch (e) {
    return { ...base, id: fallbackId, error: `plugin.json is not valid JSON (${String(e)})` };
  }
}

async function readPluginDir(dir: string, scope: PluginScope): Promise<DiscoveredPlugin[]> {
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      // A leading dot is for editor-managed sidecars (e.g. the generated `.types`
      // folder), never a plugin.
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  const found = await Promise.all(names.map((name) => readOnePlugin(path.join(dir, name), scope, name)));
  // A folder someone put in a plugins directory and got wrong is worth naming.
  // One the editor SHIPS is a package that may simply have no editor half — a
  // runtime-only plugin is not a broken one.
  return scope === 'builtin' ? found.filter((p) => p.error !== NO_MANIFEST) : found;
}

/**
 * Plugins the project installed from npm. Only DIRECT dependencies count: editor
 * code arriving because something else depends on it is not something the project
 * asked for. A `plugin.json` is the test, not the `estella-plugin-` name, which no
 * scoped package could satisfy.
 */
async function readPackagePlugins(root: string): Promise<DiscoveredPlugin[]> {
  let names: string[];
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    names = [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])].sort();
  } catch {
    return []; // no package.json, or unreadable — a project with no npm dependencies
  }
  const out: DiscoveredPlugin[] = [];
  for (const name of names) {
    const dir = path.join(root, 'node_modules', ...name.split('/'));
    // An ordinary dependency is not a broken plugin, so it is skipped in silence.
    if (!existsSync(path.join(dir, 'plugin.json'))) continue;
    out.push(await readOnePlugin(dir, 'package', name));
  }
  return out;
}

/**
 * Project platform profiles, as entries in the same list. They are not plugins and
 * gain no lifecycle from being listed — the point is that "project code the editor
 * will run" is ONE list with ONE trust decision, and this is the most privileged
 * member of it (a main-process import, full Node).
 *
 * A synthesized manifest gives the row a name and version to display and to key
 * approval by; there is no plugin.json to read because the file form predates
 * plugins and keeping it is what spares every existing project a migration.
 */
async function readPlatformProfiles(root: string): Promise<DiscoveredPlugin[]> {
  const dir = path.join(root, PROJECT_PLATFORM_DIR);
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = (await readdir(dir)).filter((n) => n.endsWith('.mjs')).sort();
  } catch {
    return [];
  }
  return files.map((name) => {
    const file = path.join(dir, name);
    const id = platformTrustId(file);
    return {
      id,
      kind: 'project-platform' as const,
      scope: 'project' as const,
      dir: file,
      manifest: {
        id,
        name: `${path.basename(name, '.mjs')} (platform)`,
        version: '0.0.0',
        main: { node: name },
        capabilities: ['process'],
      },
    };
  });
}

/**
 * Every piece of project-supplied code visible right now, most specific scope
 * first: a folder in this project beats a package it depends on, and both beat a
 * personal one installed for every project. A shadowed plugin is listed carrying
 * `shadowedBy` rather than dropped, so the UI can say why it isn't running.
 */
export async function discoverPlugins(
  root: string | null,
  userDataDir: string,
  builtinDir?: string,
): Promise<DiscoveredPlugin[]> {
  const project = root ? await readPluginDir(path.join(root, PROJECT_PLUGIN_DIR), 'project') : [];
  const platforms = root ? await readPlatformProfiles(root) : [];
  const packages = root ? await readPackagePlugins(root) : [];
  const user = await readPluginDir(path.join(userDataDir, USER_PLUGIN_DIR), 'user');
  const builtin = builtinDir ? await readPluginDir(builtinDir, 'builtin') : [];
  const claimed = new Map(project.map((p) => [p.id, p.scope]));
  const resolve = (list: DiscoveredPlugin[]): DiscoveredPlugin[] =>
    list.map((p) => {
      const by = claimed.get(p.id);
      if (by !== undefined) return { ...p, shadowedBy: by };
      claimed.set(p.id, p.scope);
      return p;
    });
  return [...project, ...platforms, ...resolve(packages), ...resolve(user), ...resolve(builtin)];
}

// =============================================================================
// Compilation
// =============================================================================

/**
 * Compile a plugin's renderer entry to a single CJS module. CJS (not ESM) because
 * the renderer loads it with an injected `require`, which is how host modules get
 * dependency-injected without a second module graph or an import map — see the
 * loader in src/plugins/loader.ts. Authors never see it: they write ESM TS.
 *
 * Never throws: a plugin that fails to build comes back with its diagnostics.
 */
export async function compilePlugin(dir: string, entryRel: string): Promise<CompiledPlugin> {
  const entry = path.join(dir, entryRel);
  if (!existsSync(entry)) {
    return { ok: false, errors: [`entry not found: ${entryRel}`], warnings: [] };
  }
  try {
    const { build } = await loadEsbuild();
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2020',
      external: EDITOR_EXTERNALS,
      jsx: 'automatic',
      write: false,
      sourcemap: 'inline',
      logLevel: 'silent',
      // Resolve bare imports from the plugin's own folder, so a plugin may vendor
      // dependencies in its node_modules and have them bundled in.
      absWorkingDir: dir,
    });
    const code = result.outputFiles?.[0]?.text;
    if (!code) return { ok: false, errors: ['esbuild produced no output'], warnings: [] };
    return {
      ok: true,
      code,
      errors: result.errors.map((e) => e.text),
      warnings: result.warnings.map((w) => w.text),
    };
  } catch (err) {
    const e = err as { errors?: { text: string }[]; warnings?: { text: string }[]; message?: string };
    return {
      ok: false,
      errors: e.errors?.map((x) => x.text) ?? [String(e.message ?? err)],
      warnings: e.warnings?.map((x) => x.text) ?? [],
    };
  }
}

// Trust + enablement live in pluginTrust.ts — shared with the project platform
// catalog, which imports project code into the MAIN process and must pass the same
// gate. Re-exported here so the plugin-facing call sites read as one host API.
export {
  isTrusted, trustPlugin, revokeTrust, isDisabled, setPluginEnabled,
} from './pluginTrust';
