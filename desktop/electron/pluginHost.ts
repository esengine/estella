// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The main-process half of the editor plugin system: find plugins, compile
 *        their entry, and remember which ones the user trusted or disabled.
 *
 * Three things the renderer cannot do for itself:
 *
 *  1. DISCOVERY. Plugins live on disk in two scopes — inside the project
 *     (`.esengine/plugins/`, versioned with it, shared by the team) and per-user
 *     (`<userData>/plugins/`, personal tools across projects). A project plugin
 *     shadows a user plugin with the same id, and the shadowed one is REPORTED
 *     rather than dropped.
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
 *     decision only the user can make. Approval is keyed by `<id>@<version>` AND
 *     the folder it was approved from: publishing a new version re-asks, and so
 *     does a different folder claiming the same id.
 *
 *     Deliberately NOT keyed by a hash of the code. That would re-prompt on every
 *     save, which is fatal to the loop of actually writing a plugin — and it buys
 *     little, since the threat model here is "code I did not write", not "code I
 *     just edited". This is the same bargain every extension ecosystem strikes:
 *     approval is per identity, and an update rides on it.
 *
 * Pure Node apart from the userData path (injected), so it stays unit-testable.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEsbuild } from './esbuildRuntime';
import { validateManifest, type PluginManifest } from '../src/plugins/manifest';
import { PROJECT_PLUGIN_REL } from '../src/plugins/paths';

/** Where a project keeps its own plugins (sibling of `.esengine/platforms/`),
 *  resolved to this OS's separator from the one shared spelling. */
export const PROJECT_PLUGIN_DIR = path.join(...PROJECT_PLUGIN_REL.split('/'));
/** Per-user plugin folder name, under Electron's userData. */
export const USER_PLUGIN_DIR = 'plugins';

/** Which scope a plugin was found in. Project shadows user on an id collision. */
export type PluginScope = 'project' | 'user';

/** What the renderer needs to list one plugin. Serializable by construction. */
export interface DiscoveredPlugin {
  id: string;
  scope: PluginScope;
  /** Absolute plugin folder — shown in the UI and opened by "Reveal". */
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
  const out: DiscoveredPlugin[] = [];
  for (const name of names) {
    const pluginDir = path.join(dir, name);
    const manifestFile = path.join(pluginDir, 'plugin.json');
    if (!existsSync(manifestFile)) {
      out.push({ id: name, scope, dir: pluginDir, error: 'folder has no plugin.json' });
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
      const result = validateManifest(parsed);
      if ('error' in result) {
        out.push({ id: name, scope, dir: pluginDir, error: result.error });
      } else {
        out.push({ id: result.manifest.id, scope, dir: pluginDir, manifest: result.manifest });
      }
    } catch (e) {
      out.push({ id: name, scope, dir: pluginDir, error: `plugin.json is not valid JSON (${String(e)})` });
    }
  }
  return out;
}

/**
 * Every plugin visible right now, project scope first. A user plugin whose id a
 * project plugin also claims is listed with `shadowedBy`, so the UI can explain
 * why it isn't running instead of leaving the user wondering.
 */
export async function discoverPlugins(root: string | null, userDataDir: string): Promise<DiscoveredPlugin[]> {
  const project = root ? await readPluginDir(path.join(root, PROJECT_PLUGIN_DIR), 'project') : [];
  const user = await readPluginDir(path.join(userDataDir, USER_PLUGIN_DIR), 'user');
  const claimed = new Set(project.map((p) => p.id));
  return [
    ...project,
    ...user.map((p) => (claimed.has(p.id) ? { ...p, shadowedBy: 'project' as PluginScope } : p)),
  ];
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

// =============================================================================
// Trust + enablement (per-user, in userData)
// =============================================================================

interface TrustFile {
  /** `<id>@<version>` → the absolute folder it was approved from. */
  trusted: Record<string, string>;
  /** ids the user switched off (independent of trust). */
  disabled: string[];
}

/** Approval identity: a version bump or a different folder re-asks. */
const trustKey = (id: string, version: string): string => `${id}@${version}`;

const EMPTY: TrustFile = { trusted: {}, disabled: [] };

const trustFile = (userDataDir: string): string => path.join(userDataDir, 'estella-plugin-trust.json');

function readTrust(userDataDir: string): TrustFile {
  try {
    const raw: unknown = JSON.parse(readFileSync(trustFile(userDataDir), 'utf8'));
    const f = raw as Partial<TrustFile>;
    return {
      trusted: f.trusted && typeof f.trusted === 'object' ? f.trusted : {},
      disabled: Array.isArray(f.disabled) ? f.disabled : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

function writeTrust(userDataDir: string, next: TrustFile): void {
  try {
    writeFileSync(trustFile(userDataDir), `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    /* read-only profile — trust simply won't persist this session */
  }
}

/** Whether the user approved this plugin id + version, from this folder. */
export function isTrusted(userDataDir: string, id: string, version: string, dir: string): boolean {
  return readTrust(userDataDir).trusted[trustKey(id, version)] === dir;
}

export function trustPlugin(userDataDir: string, id: string, version: string, dir: string): void {
  const f = readTrust(userDataDir);
  f.trusted[trustKey(id, version)] = dir;
  writeTrust(userDataDir, f);
}

/** Withdraw approval for every version of a plugin; it stops loading until re-approved. */
export function revokeTrust(userDataDir: string, id: string): void {
  const f = readTrust(userDataDir);
  for (const key of Object.keys(f.trusted)) {
    if (key.startsWith(`${id}@`)) delete f.trusted[key];
  }
  writeTrust(userDataDir, f);
}

export function isDisabled(userDataDir: string, id: string): boolean {
  return readTrust(userDataDir).disabled.includes(id);
}

export function setPluginEnabled(userDataDir: string, id: string, enabled: boolean): void {
  const f = readTrust(userDataDir);
  const set = new Set(f.disabled);
  if (enabled) set.delete(id);
  else set.add(id);
  f.disabled = [...set].sort();
  writeTrust(userDataDir, f);
}
