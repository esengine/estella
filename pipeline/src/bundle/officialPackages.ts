// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The official runtime packages (`estella-plugin-*`) resolve to the copy
 *        the editor ships, for every bundle a project's scripts go into.
 *
 * They are not on any registry: the editor carries `plugins/` beside itself, so
 * `import … from 'estella-plugin-minigame-services'` has to be answered here or
 * nowhere. A copy the project installed into its own node_modules still wins —
 * that is a choice someone made, and the built-in one is only the default.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'esbuild';

const OFFICIAL = /^(estella-plugin-[^/]+)(\/.+)?$/;

/** A package name → its export subpath ('.', './open-data') → absolute entry file. */
export type OfficialPackages = ReadonlyMap<string, ReadonlyMap<string, string>>;

const cache = new Map<string, OfficialPackages>();

export function readOfficialPackages(packagesDir: string): OfficialPackages {
  const hit = cache.get(packagesDir);
  if (hit) return hit;
  const out = new Map<string, Map<string, string>>();
  const entries = existsSync(packagesDir) ? readdirSync(packagesDir, { withFileTypes: true }) : [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesDir, entry.name);
    const manifest = path.join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name?: string; main?: string; exports?: string | Record<string, string>;
    };
    if (!pkg.name || !OFFICIAL.test(pkg.name)) continue;
    const exportsMap = typeof pkg.exports === 'string' ? { '.': pkg.exports }
      : pkg.exports ?? (pkg.main ? { '.': pkg.main } : {});
    const subpaths = new Map<string, string>();
    for (const [sub, rel] of Object.entries(exportsMap)) subpaths.set(sub, path.join(dir, rel));
    out.set(pkg.name, subpaths);
  }
  cache.set(packagesDir, out);
  return out;
}

const SKIP = Symbol('official-packages:skip');

/** esbuild plugin: `estella-plugin-*` from the project's node_modules if it has
 *  one, otherwise from `packagesDir`. */
export function officialPackagesPlugin(packagesDir: string): Plugin {
  return {
    name: 'estella-official-packages',
    setup(build) {
      build.onResolve({ filter: OFFICIAL }, async (args) => {
        if (args.pluginData === SKIP) return undefined;
        const own = await build.resolve(args.path, {
          kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: SKIP,
        });
        if (own.errors.length === 0) return { path: own.path, external: own.external, sideEffects: own.sideEffects };

        const [, name, rest] = OFFICIAL.exec(args.path)!;
        const packages = readOfficialPackages(packagesDir);
        const subpaths = packages.get(name);
        if (!subpaths) {
          return { errors: [{ text: `"${name}" is not one of the packages the editor ships (${[...packages.keys()].join(', ') || 'none found'}), and the project has not installed it` }] };
        }
        const entry = subpaths.get(rest ? `.${rest}` : '.');
        if (!entry) {
          return { errors: [{ text: `"${name}" exports no "${rest ? `.${rest}` : '.'}" — it exports ${[...subpaths.keys()].join(', ')}` }] };
        }
        return { path: entry };
      });
    },
  };
}
