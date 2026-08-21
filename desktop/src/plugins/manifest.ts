// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  manifest.ts
 * @brief The `plugin.json` contract and its validation — shared by the main
 *        process (which reads it off disk) and the renderer (which shows it and
 *        activates from it), so the two can never disagree about what a valid
 *        plugin is. Pure: no Node, no Electron, no React.
 *
 * Validation NEVER throws and never silently drops: a plugin whose manifest is
 * malformed still appears in the list, carrying the reason. Dropping a file the
 * user wrote is worse than naming what's wrong with it — the same posture
 * electron/platformCatalog.ts takes for project platform profiles.
 */

// LocalizedString is owned by the public type surface (types.ts) — one spelling
// for the manifest and for every contribution a plugin registers.
import type { LocalizedString } from '@estella/editor-api';

export type { LocalizedString };

/** Declared side effects, shown to the user at the trust prompt. */
export type PluginCapability = 'fs:project' | 'net' | 'shell' | 'process';

export const PLUGIN_CAPABILITIES: readonly PluginCapability[] = ['fs:project', 'net', 'shell', 'process'];

export interface PluginManifest {
  /** Stable, namespaced: `<publisher>.<name>` by convention. */
  id: string;
  name: LocalizedString;
  version: string;
  description?: LocalizedString;
  publisher?: string;
  /** Editor version range this plugin claims to work with (e.g. `^0.33`). */
  engines?: { editor?: string };
  /** Entry points, project-relative to the plugin dir. `editor` runs in the
   *  renderer; `node` (a later phase) in the main process. */
  main?: { editor?: string; node?: string };
  /** Declared capabilities — disclosure at the trust prompt, and what the
   *  convenience APIs on the plugin context are gated on. */
  capabilities?: PluginCapability[];
}

/** Resolve a localized string for a locale, falling back to `en` then any value. */
export function resolveLocalized(value: LocalizedString | undefined, locale: string): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return value[locale] ?? value.en ?? Object.values(value)[0] ?? '';
}

/** Ids must be filesystem- and namespace-safe, and readable in a command palette. */
const ID_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

/**
 * Why this id is unusable, or null if it is fine. Exported because the scaffolder
 * must reject a bad id BEFORE writing a folder — validating with the same function
 * that later reads the manifest is what keeps "the editor let me create it" and
 * "the editor accepts it" from ever disagreeing.
 */
export function pluginIdProblem(id: unknown): string | null {
  if (typeof id !== 'string' || id.length === 0) return 'plugin needs an `id`';
  if (!ID_RE.test(id)) return '`id` must be a dotted, lowercase name like "acme.level-tools"';
  return null;
}

const isLocalized = (v: unknown): boolean =>
  typeof v === 'string'
    ? v.length > 0
    : !!v && typeof v === 'object' && typeof (v as { en?: unknown }).en === 'string';

/**
 * Validate a parsed `plugin.json`. Returns the typed manifest, or the first
 * problem as a human sentence (which is what the Plugins panel shows).
 */
export function validateManifest(raw: unknown): { manifest: PluginManifest } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'plugin.json must contain a JSON object' };
  const m = raw as Record<string, unknown>;

  const idBad = pluginIdProblem(m.id);
  if (idBad) return { error: idBad };
  if (!isLocalized(m.name)) {
    return { error: '`name` must be a non-empty string, or an object with an `en` string' };
  }
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+/.test(m.version)) {
    return { error: '`version` must be a semver string like "1.0.0"' };
  }
  if (m.description !== undefined && !isLocalized(m.description)) {
    return { error: '`description` must be a string, or an object with an `en` string' };
  }
  const main = m.main as Record<string, unknown> | undefined;
  if (main !== undefined && (typeof main !== 'object' || main === null)) {
    return { error: '`main` must be an object like { "editor": "src/editor.ts" }' };
  }
  if (main?.editor !== undefined && typeof main.editor !== 'string') {
    return { error: '`main.editor` must be a path relative to the plugin folder' };
  }
  if (main?.node !== undefined && typeof main.node !== 'string') {
    return { error: '`main.node` must be a path relative to the plugin folder' };
  }
  if (!main?.editor && !main?.node) {
    return { error: 'plugin has no entry point — set `main.editor` (e.g. "src/editor.ts")' };
  }
  if (main?.editor && !main.node && typeof main.editor === 'string' && main.editor.includes('..')) {
    return { error: '`main.editor` must stay inside the plugin folder' };
  }
  if (m.capabilities !== undefined) {
    if (!Array.isArray(m.capabilities)) return { error: '`capabilities` must be an array of strings' };
    const bad = m.capabilities.find((c) => !PLUGIN_CAPABILITIES.includes(c as PluginCapability));
    if (bad !== undefined) {
      return { error: `unknown capability ${JSON.stringify(bad)} (known: ${PLUGIN_CAPABILITIES.join(', ')})` };
    }
  }
  const engines = m.engines as Record<string, unknown> | undefined;
  if (engines?.editor !== undefined && typeof engines.editor !== 'string') {
    return { error: '`engines.editor` must be a version range string like "^0.33"' };
  }
  return { manifest: raw as PluginManifest };
}

/**
 * Whether `version` satisfies `range`. Deliberately supports only the three
 * spellings a plugin should need — `*`, `^x.y[.z]`, and `>=x.y[.z]` — and REJECTS
 * anything else rather than guessing: a range we silently misread would load a
 * plugin against an API it wasn't written for.
 */
export function satisfiesEditorRange(version: string, range: string): { ok: true } | { ok: false; reason: string } {
  const parse = (v: string): [number, number, number] | null => {
    const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
  };
  const current = parse(version);
  if (!current) return { ok: false, reason: `cannot read editor version "${version}"` };

  const r = range.trim();
  if (r === '*') return { ok: true };

  const op = r.startsWith('^') ? '^' : r.startsWith('>=') ? '>=' : '=';
  const wanted = parse(r.replace(/^(\^|>=)/, ''));
  if (!wanted) return { ok: false, reason: `cannot read version range "${range}" (use "*", "^0.33", or ">=0.33")` };

  const cmp = current[0] - wanted[0] || current[1] - wanted[1] || current[2] - wanted[2];
  if (op === '>=') {
    return cmp >= 0 ? { ok: true } : { ok: false, reason: `needs editor >= ${r.slice(2)}, running ${version}` };
  }
  if (op === '=') {
    return cmp === 0 ? { ok: true } : { ok: false, reason: `needs editor ${r}, running ${version}` };
  }
  // Caret. Below 1.0.0 the MINOR is the breaking-change axis (npm semantics), and
  // the editor is pre-1.0 — so ^0.33 must not match 0.34.
  if (cmp < 0) return { ok: false, reason: `needs editor ${r}, running ${version}` };
  const sameMajorLine = wanted[0] === 0 ? current[0] === 0 && current[1] === wanted[1] : current[0] === wanted[0];
  return sameMajorLine ? { ok: true } : { ok: false, reason: `needs editor ${r}, running ${version}` };
}
