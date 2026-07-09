// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  AssetDatabase scanner (REARCH_ASSETS.md A2). The single project-level
 *        index of "what assets exist": walk the project, read each `.meta`
 *        sidecar (uuid / type / importer), and build a uuid→path registry plus a
 *        dependency graph (which scene/prefab references which asset). The result
 *        is written to `.esengine/cache/assets.json` (the artifact pattern shared
 *        with schemas.json / scripts.mjs) and returned for the editor to load.
 *
 * The editor consumes this instead of resolving assets ad-hoc: it feeds the
 * entries into the engine `Assets` registry (one resolution path), drives the
 * Content Browser from it, and (later) cooks ship bundles by walking `deps`.
 *
 * Pure Node (fs/path), no Electron imports → unit-testable; IPC wiring is in
 * main.ts. The `.meta` files carry the authored `type`, so this needs no
 * extension→type table — it reads the type each meta already declares.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { META_EXT, isContentDir } from './contentPolicy';
// The runtime's tileset-path resolver (a dependency-free leaf) — shared so the dep scan
// discovers a tilemap's tileset images the same way the loader will later request them.
import { resolveRelativePath } from '../../sdk/src/tilemap/tiledPath';

/** Local, gitignored cache inside the project (next to workspace.json). */
const CACHE_DIR = '.esengine/cache';
const OUTPUT = 'assets.json';
const UUID_PREFIX = '@uuid:';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One asset: stable uuid, current project-relative path, type + importer settings. */
export interface AssetEntry {
  uuid: string;
  path: string;
  type: string;
  importer?: Record<string, unknown>;
}

/**
 * The project asset index. `entries` is the uuid↔path registry; `deps` maps a
 * scene/prefab uuid to the asset uuids it references (for delete-detection +
 * cook). Same `version`/`entries` shape as the engine's AssetManifest, extended.
 */
export interface AssetIndex {
  version: '1.0';
  entries: AssetEntry[];
  deps: Record<string, string[]>;
}

export interface ScanAssetsResult {
  ok: boolean;
  /** Absolute path to the written assets.json, or null if not written. */
  outputPath: string | null;
  index: AssetIndex;
  warnings: string[];
}

/** Recursively yield every `<file>.meta` path (project-relative, forward-slashed). */
async function* walkMeta(root: string, rel = ''): AsyncGenerator<string> {
  const abs = rel ? path.join(root, rel) : root;
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return; // unreadable dir
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!isContentDir(e.name)) continue;
      yield* walkMeta(root, rel ? `${rel}/${e.name}` : e.name);
    } else if (e.name.endsWith(META_EXT)) {
      yield rel ? `${rel}/${e.name}` : e.name;
    }
  }
}

/**
 * Asset types whose JSON documents can reference other assets — these are
 * dependency-scanned so the cook's reachability closure includes what they
 * pull in (a material's shader + textures, a tileset's atlas, a tilemap's tileset
 * images, …).
 */
const JSON_REF_TYPES = new Set([
  'scene', 'prefab', 'material', 'tileset', 'tilemap', 'animclip', 'statemachine', 'behaviortree',
]);

/**
 * Collect every asset reference in a JSON document:
 *   - `@uuid:<id>` refs (editor-serialized stable refs)
 *   - BARE uuid strings, only when they name a real asset (anim-clip flipbook
 *     frames serialize these — the runtime's extractUuid form; entity ids are
 *     uuid-shaped too, so index membership is the filter)
 *   - PATH refs, resolved through @p resolvePath (real content references
 *     materials/textures by project path, not uuid — a dep graph that only
 *     reads `@uuid:` sees an empty project and the cook culls everything)
 */
function collectRefs(
  value: unknown,
  into: Set<string>,
  resolvePath?: (ref: string) => string | null,
  knownUuid?: (id: string) => boolean,
): void {
  if (typeof value === 'string') {
    if (value.startsWith(UUID_PREFIX)) {
      const id = value.slice(UUID_PREFIX.length).toLowerCase();
      if (UUID_V4.test(id)) into.add(id);
      return;
    }
    if (UUID_V4.test(value)) {
      const id = value.toLowerCase();
      if (knownUuid?.(id)) into.add(id);
      return;
    }
    const uuid = resolvePath?.(value);
    if (uuid) into.add(uuid);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, into, resolvePath, knownUuid);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectRefs(v, into, resolvePath, knownUuid);
    }
  }
}

/** Normalize a ref for path-index lookup (forward slashes, no ./ or leading /). */
function normalizeRefPath(ref: string): string {
  return ref.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

/**
 * Scan `root` for `.meta` sidecars → build the asset index (registry + dep
 * graph) and (unless `write: false`) write `.esengine/cache/assets.json`.
 */
export async function scanAssetDatabase(
  root: string,
  opts?: { write?: boolean },
): Promise<ScanAssetsResult> {
  const entries: AssetEntry[] = [];
  const warnings: string[] = [];

  for await (const metaRel of walkMeta(root)) {
    let meta: { uuid?: unknown; type?: unknown; importer?: unknown };
    try {
      meta = JSON.parse(await readFile(path.join(root, metaRel), 'utf8'));
    } catch (err) {
      warnings.push(`${metaRel}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (typeof meta?.uuid !== 'string' || typeof meta?.type !== 'string') {
      warnings.push(`${metaRel}: missing uuid or type`);
      continue;
    }
    entries.push({
      uuid: meta.uuid.toLowerCase(),
      path: metaRel.replace(/\.meta$/, ''),
      type: meta.type,
      importer: (meta.importer as Record<string, unknown>) ?? {},
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  // Dependency graph: any JSON asset can reference others — by uuid or by path
  // (project-relative like a scene's "assets/materials/x.esmaterial", or
  // relative to the referencing document's own directory like a material's
  // "shader": "x.esshader"). Path refs resolve against the index, so only
  // strings naming a real asset create edges — no false positives.
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const uuids = new Set(entries.map((e) => e.uuid));
  const deps: Record<string, string[]> = {};
  for (const entry of entries) {
    if (!JSON_REF_TYPES.has(entry.type)) continue;
    try {
      const json = JSON.parse(await readFile(path.join(root, entry.path), 'utf8'));
      const refs = new Set<string>();
      collectRefs(json, refs, (ref) => {
        if (ref.includes('://')) return null;
        const direct = byPath.get(normalizeRefPath(ref));
        if (direct) return direct.uuid;
        // Fall back to a path RELATIVE to the referencing document, resolved the way
        // the runtime loads it (collapsing ./ and ../) — so a Tiled tileset image
        // "../textures/tileset.png" or a material's sibling "x.esshader" resolves to
        // the same asset the loader will request. (The old join left "../" uncollapsed,
        // so tilemap tileset images never linked and the cook culled them → the
        // single-file playable 404'd them.)
        const rel = byPath.get(normalizeRefPath(resolveRelativePath(entry.path, ref)));
        return rel?.uuid ?? null;
      }, (id) => uuids.has(id));
      refs.delete(entry.uuid);
      if (refs.size > 0) deps[entry.uuid] = [...refs].sort();
    } catch (err) {
      warnings.push(`${entry.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const index: AssetIndex = { version: '1.0', entries, deps };

  let outputPath: string | null = null;
  if (opts?.write !== false) {
    outputPath = path.join(root, CACHE_DIR, OUTPUT);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(index, null, 2) + '\n');
  }

  return { ok: true, outputPath, index, warnings };
}
