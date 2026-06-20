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

/** Local, gitignored cache inside the project (next to workspace.json). */
const CACHE_DIR = '.esengine/cache';
const OUTPUT = 'assets.json';
/** Dirs never scanned for assets — code/build/vcs, not content. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.esengine', 'dist', 'dist-electron', 'build', '.vscode', '.cache',
]);
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
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walkMeta(root, rel ? `${rel}/${e.name}` : e.name);
    } else if (e.name.endsWith('.meta')) {
      yield rel ? `${rel}/${e.name}` : e.name;
    }
  }
}

/** Collect every `@uuid:<id>` (or bare uuid) referenced in a scene/prefab JSON. */
function collectRefs(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith(UUID_PREFIX)) {
      const id = value.slice(UUID_PREFIX.length).toLowerCase();
      if (UUID_V4.test(id)) into.add(id);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectRefs(v, into);
  }
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

  // Dependency graph: scenes/prefabs reference assets by uuid.
  const deps: Record<string, string[]> = {};
  for (const entry of entries) {
    if (entry.type !== 'scene' && entry.type !== 'prefab') continue;
    try {
      const json = JSON.parse(await readFile(path.join(root, entry.path), 'utf8'));
      const refs = new Set<string>();
      collectRefs(json, refs);
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
