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
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readTextInRoot } from './projectFs';
import { META_EXT, isContentDir, isContentFile, isNonContentPath } from './contentPolicy';
import { adoptOrphan } from './assetMeta';
// The runtime's tileset-path resolver (a dependency-free leaf) — shared so the dep scan
// discovers a tilemap's tileset images the same way the loader will later request them.
import { resolveRelativePath } from '../../sdk/src/tilemap/tiledPath';
// The spine-atlas page parser (a dependency-free leaf) — shared with the runtime loaders
// so the dep scan discovers an atlas's texture pages the same way they will be requested.
import { parseSpineAtlasPages } from '../../sdk/src/spine/atlasPages';
import { getEditorType } from '../../sdk/src/assetTypes';

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
  /** Orphan content files the scan adopted (minted a `.meta` for) this pass. */
  adopted: string[];
  /** Files whose `.meta` carried a uuid another file already had, re-minted this
   *  pass (see {@link resolveDuplicateUuids}). */
  reminted: string[];
  /** Per-sub-phase wall time (ms) — surfaced in the renderer boot profile so the
   *  cost of this O(files) scan is visible and attributable (adopt vs meta-walk
   *  vs dependency graph vs write-back). */
  timingMs?: { adopt: number; walk: number; deps: number; write: number; total: number; files: number };
}

/**
 * Give every file its own identity back when two `.meta`s claim the same uuid.
 *
 * A uuid IS the asset's identity: every stored reference is written against it, and
 * the registry is a uuid→path map. Two files sharing one means the map keeps a
 * single winner — so one of the files is not in the registry at all, and every ref
 * to that uuid resolves to the other. Nothing about that is visible: the Content
 * Browser lists files from disk and previews the path it selected, so the picture on
 * screen is right, while the sprite in the scene shows a DIFFERENT image. That is
 * how it gets reported — "what I dropped is not what I see" — and the last place
 * anyone looks is the sidecar.
 *
 * Duplicates arrive in bulk: a folder copied in with its sidecars, a script that
 * stamped one uuid into every meta it wrote, a file duplicated outside the editor.
 *
 * The first file in path order keeps the uuid (deterministic, so a re-scan does not
 * shuffle identities); the rest are re-minted on disk. Re-minting is safe precisely
 * BECAUSE the uuid was ambiguous: no reference to it could have been resolving
 * reliably, and a ref that now fails to resolve says so in diagnostics instead of
 * quietly drawing the wrong thing.
 */
async function resolveDuplicateUuids(
  root: string,
  entries: AssetEntry[],
  warnings: string[],
): Promise<string[]> {
  const owner = new Map<string, string>();
  const reminted: string[] = [];
  for (const entry of entries) {
    const first = owner.get(entry.uuid);
    if (first === undefined) {
      owner.set(entry.uuid, entry.path);
      continue;
    }
    const fresh = randomUUID();
    try {
      const metaPath = path.join(root, `${entry.path}${META_EXT}`);
      const meta = JSON.parse(await readTextInRoot(metaPath)) as Record<string, unknown>;
      meta.uuid = fresh;
      await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    } catch (err) {
      warnings.push(
        `${entry.path}: shares its uuid with ${first} and could not be re-minted `
        + `(${err instanceof Error ? err.message : String(err)}) — it is not addressable`,
      );
      continue;
    }
    warnings.push(`${entry.path}: shared its uuid with ${first}; re-minted as ${fresh}`);
    entry.uuid = fresh;
    owner.set(fresh, entry.path);
    reminted.push(entry.path);
  }
  return reminted;
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
 * Adopt orphan content files: any content file of a known asset type with no
 * `.meta` sidecar gets one minted, so it enters the index THIS scan. "I dropped
 * my asset folder into the project and opened it" is the first thing every new
 * user does — files arriving outside the import door (git, Finder, an agent's
 * bulk copy) must not stay invisible to the registry. Unknown extensions
 * (docs, source files) are left alone.
 */
async function adoptOrphans(root: string, rel = '', adopted: string[] = []): Promise<string[]> {
  const abs = rel ? path.join(root, rel) : root;
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return adopted; // unreadable dir
  }
  for (const e of entries) {
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!isContentDir(e.name)) continue;
      await adoptOrphans(root, relPath, adopted);
    } else if (isContentFile(e.name)) {
      // The project-root thumbnail.png is the editor-managed launcher cover
      // (rewritten on every scene save), not an asset — adopting it would put
      // a churning file in the registry.
      if (relPath === 'thumbnail.png') continue;
      if ((await adoptOrphan(path.join(abs, e.name))) === 'adopted') adopted.push(relPath);
    }
  }
  return adopted;
}

/**
 * Asset types whose JSON documents can reference other assets — these are
 * dependency-scanned so the cook's reachability closure includes what they
 * pull in (a material's shader + textures, a tileset's atlas, a tilemap's tileset
 * images, …).
 */
// 'animation' covers .estimeline (AnimFrames tracks reference textures) and
// legacy .esanim metas written before the type split to 'animclip'.
// A skeletal atlas names its page images, and nothing else in the project does —
// no component references them. Scanned for deps whatever their own asset type is,
// so the cook keeps the textures instead of shipping an atlas that 404s them.
const SKELETAL_ATLAS_TYPES = new Set(['spine-atlas', 'dragonbones-atlas']);

// 'json' is a game's own data table. It is scanned like the rest because a
// data-driven game names assets FROM its data — a spawn table holding `@uuid:`
// refs is the ordinary way to do that — and an unscanned table means the cook
// culls what only it points at, which surfaces as a missing asset in the build
// and nowhere else.
const JSON_REF_TYPES = new Set([
  'scene', 'prefab', 'material', 'tileset', 'tilemap', 'animclip', 'animation', 'statemachine', 'behaviortree',
  'json',
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
 * Bounded-concurrency map preserving output order. The scan reads hundreds of
 * tiny files; serial `await readFile` left the disk idle between reads (~5×
 * slower than parallel on an 800-file project). This keeps a fixed number of
 * reads in flight — fast, but without the unbounded fd/memory pressure a raw
 * `Promise.all` would put on a very large tree.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Reads in flight during the scan's meta-walk and dependency-graph passes. */
const SCAN_IO_CONCURRENCY = 48;

/**
 * Build the dependency edges for `targets` (default: every ref-carrying entry),
 * resolving refs against the FULL `entries` set. Any JSON asset can reference
 * others by uuid or by path (project-relative, or relative to the referencing
 * document); only strings naming a real asset create edges — no false positives.
 * Returns a partial deps map (`uuid → sorted ref uuids`, edge-bearing only) so the
 * incremental path can recompute just the touched assets and merge over the rest.
 */
async function computeDeps(
  root: string,
  entries: readonly AssetEntry[],
  targets?: readonly AssetEntry[],
): Promise<{ deps: Record<string, string[]>; warnings: string[] }> {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const uuids = new Set(entries.map((e) => e.uuid));
  const refEntries = (targets ?? entries).filter(
    (e) => JSON_REF_TYPES.has(e.type) || SKELETAL_ATLAS_TYPES.has(getEditorType(e.path)),
  );
  type DepResult = { uuid: string; refs: string[] } | { warning: string };
  const depResults = await mapLimit(refEntries, SCAN_IO_CONCURRENCY, async (entry): Promise<DepResult> => {
    // A spine `.atlas` is a TEXT manifest (not JSON): its page image names are
    // texture deps — the same edge the SpineAssetLoader walks at runtime. Scan it
    // apart from the JSON path so the cook embeds those textures (else the atlas
    // ships but its .png is culled and the playable 404s it).
    // Spine's atlas is a TEXT manifest and needs its own parser; DragonBones'
    // is JSON, so the generic walk below already finds its `imagePath`.
    const isSpineAtlas = getEditorType(entry.path) === 'spine-atlas';
    try {
      const refs = new Set<string>();
      if (isSpineAtlas) {
        const content = await readTextInRoot(path.join(root, entry.path));
        for (const page of parseSpineAtlasPages(content)) {
          const dep = byPath.get(normalizeRefPath(resolveRelativePath(entry.path, page)));
          if (dep) refs.add(dep.uuid);
        }
      } else {
        const json = JSON.parse(await readTextInRoot(path.join(root, entry.path)));
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
      }
      refs.delete(entry.uuid);
      return { uuid: entry.uuid, refs: [...refs].sort() };
    } catch (err) {
      return { warning: `${entry.path}: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
  const deps: Record<string, string[]> = {};
  const warnings: string[] = [];
  for (const r of depResults) {
    if ('warning' in r) warnings.push(r.warning);
    else if (r.refs.length > 0) deps[r.uuid] = r.refs;
  }
  return { deps, warnings };
}

/**
 * Write `.esengine/cache/assets.json` only when its bytes actually change. The
 * watcher can't tell our cache write from a real edit, so an unconditional write
 * would make every refresh re-trigger itself (scan → write → fsChanged → scan …).
 * Returns the artifact path.
 */
async function writeIndexIfChanged(root: string, index: AssetIndex): Promise<string> {
  const outputPath = path.join(root, CACHE_DIR, OUTPUT);
  const text = JSON.stringify(index, null, 2) + '\n';
  let previous: string | null = null;
  try {
    previous = await readFile(outputPath, 'utf8');
  } catch {
    previous = null;
  }
  if (previous !== text) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, text);
  }
  return outputPath;
}

/**
 * Read the cached asset index (assets.json) WITHOUT walking the tree. The boot
 * path uses this to build the registry immediately — the full O(files) scan
 * (~1.5s cold on an 800-file project, dominated by per-file disk reads) then
 * runs off the critical path to catch anything changed while the project was
 * closed. Returns null when the cache is absent/unparseable/malformed, so the
 * caller falls back to a full scan (first-ever open of a project).
 */
export async function readCachedAssetIndex(root: string): Promise<AssetIndex | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, CACHE_DIR, OUTPUT), 'utf8'));
    if (raw && Array.isArray(raw.entries)) {
      return {
        version: typeof raw.version === 'string' ? raw.version : '1.0',
        entries: raw.entries as AssetEntry[],
        deps: (raw.deps as Record<string, string[]>) ?? {},
      };
    }
  } catch {
    // missing or malformed — caller falls back to a full scan
  }
  return null;
}

/**
 * Scan `root` for `.meta` sidecars → build the asset index (registry + dep
 * graph) and (unless `write: false`) write `.esengine/cache/assets.json`.
 */
export async function scanAssetDatabase(
  root: string,
  opts?: { write?: boolean; adopt?: boolean },
): Promise<ScanAssetsResult> {
  const entries: AssetEntry[] = [];
  const warnings: string[] = [];

  // Sub-phase timing: this scan is O(files) and runs on every project open, so
  // make each phase's cost visible (returned as timingMs, folded into the boot
  // profile). performance.now() is a Node global.
  const t = { adopt: 0, walk: 0, deps: 0, write: 0 };
  const tStart = performance.now();

  // Adopt-before-index: orphans minted here are picked up by the meta walk below,
  // so a single scan both registers and indexes them (no second pass needed).
  const adopted = opts?.adopt === false ? [] : await adoptOrphans(root);
  t.adopt = performance.now() - tStart;

  const tWalk = performance.now();
  // The generator walk is just readdir (cheap); the readFile+parse per .meta is
  // the cost — run those in parallel, then assemble deterministically in order.
  const metaRels: string[] = [];
  for await (const metaRel of walkMeta(root)) metaRels.push(metaRel);
  type WalkResult = { entry?: AssetEntry; warning?: string };
  const walkResults = await mapLimit(metaRels, SCAN_IO_CONCURRENCY, async (metaRel): Promise<WalkResult> => {
    let meta: { uuid?: unknown; type?: unknown; importer?: unknown };
    try {
      meta = JSON.parse(await readTextInRoot(path.join(root, metaRel)));
    } catch (err) {
      return { warning: `${metaRel}: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (typeof meta?.uuid !== 'string' || typeof meta?.type !== 'string') {
      return { warning: `${metaRel}: missing uuid or type` };
    }
    return {
      entry: {
        uuid: meta.uuid.toLowerCase(),
        path: metaRel.replace(/\.meta$/, ''),
        type: meta.type,
        importer: (meta.importer as Record<string, unknown>) ?? {},
      },
    };
  });
  for (const r of walkResults) {
    if (r.entry) entries.push(r.entry);
    else if (r.warning) warnings.push(r.warning);
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  // Sorted FIRST: which file keeps a shared uuid has to be the same answer on every
  // machine and every re-scan, and path order is the only stable one here.
  const reminted = await resolveDuplicateUuids(root, entries, warnings);
  t.walk = performance.now() - tWalk;

  const tDeps = performance.now();
  const { deps, warnings: depWarnings } = await computeDeps(root, entries);
  warnings.push(...depWarnings);

  t.deps = performance.now() - tDeps;
  const index: AssetIndex = { version: '1.0', entries, deps };

  const tWrite = performance.now();
  const outputPath = opts?.write !== false ? await writeIndexIfChanged(root, index) : null;

  t.write = performance.now() - tWrite;
  const round1 = (n: number): number => Math.round(n * 10) / 10;
  const timingMs = {
    adopt: round1(t.adopt), walk: round1(t.walk), deps: round1(t.deps), write: round1(t.write),
    total: round1(performance.now() - tStart), files: entries.length,
  };
  console.info(
    `[boot] scanAssetDatabase: ${timingMs.total}ms (${timingMs.files} assets) — ` +
    `adopt ${timingMs.adopt} / walk ${timingMs.walk} / deps ${timingMs.deps} / write ${timingMs.write}`,
  );

  return { ok: true, outputPath, index, warnings, adopted, reminted, timingMs };
}

/** Above this many changed paths a full rescan is cheaper/safer than per-path
 *  work — a bulk edit (git checkout, a dropped asset folder) rather than a save. */
export const INCREMENTAL_PATH_LIMIT = 100;

/** A {@link ScanAssetsResult} plus whether the incremental path fell back to a
 *  full rescan (and why) — so the caller can log it and pick its cache strategy. */
export type IncrementalScanResult = ScanAssetsResult & { fullRescan: boolean; reason?: string };

/**
 * Incrementally update a previous {@link AssetIndex} for exactly the `changed`
 * paths the watcher delivered, instead of re-walking the whole tree (the full
 * scan is ~1.5s cold, dominated by reading EVERY `.meta`). The result is what a
 * full {@link scanAssetDatabase} of the same on-disk state would produce —
 * identical `entries` AND `deps` — so Find Usages, delete warnings and the cook
 * see the same graph.
 *
 * Falls back to a full rescan (returning `fullRescan: true` + a `reason`, never
 * silently) for what a per-path update can't cover: an empty change set (watcher
 * overflow, filename unknown), a bulk change above {@link INCREMENTAL_PATH_LIMIT},
 * or a directory create/rename/move (the file moves under it aren't in `changed`).
 */
export async function updateAssetIndex(
  root: string,
  prev: AssetIndex,
  changed: readonly string[],
  opts?: { write?: boolean },
): Promise<IncrementalScanResult> {
  const full = async (reason: string): Promise<IncrementalScanResult> => ({
    ...(await scanAssetDatabase(root, opts)),
    fullRescan: true,
    reason,
  });

  if (changed.length === 0) return full('watcher overflow (no paths)');
  if (changed.length > INCREMENTAL_PATH_LIMIT) return full(`bulk change (${changed.length} paths)`);

  // The content paths touched (strip `.meta` pairing; dedup — a texture edit fires
  // both foo.png and foo.png.meta). Skip plumbing paths + the editor-managed cover.
  const contentPaths = new Set<string>();
  for (const raw of changed) {
    const rel = raw.replace(/\\/g, '/');
    if (isNonContentPath(rel)) continue;
    const abs = path.join(root, rel);
    let st: Awaited<ReturnType<typeof stat>> | null;
    try { st = await stat(abs); } catch { st = null; }
    if (st?.isDirectory()) return full(`directory changed (${rel})`);
    const content = rel.endsWith(META_EXT) ? rel.slice(0, -META_EXT.length) : rel;
    if (content === '' || content === 'thumbnail.png') continue;
    // A vanished path that WAS a directory holding assets → its removed children
    // aren't in `changed`, so only a full walk stays consistent.
    if (!st && prev.entries.some((e) => e.path.startsWith(`${content}/`))) {
      return full(`directory removed (${content})`);
    }
    contentPaths.add(content);
  }
  if (contentPaths.size === 0) {
    return { ok: true, outputPath: null, index: prev, warnings: [], adopted: [], reminted: [], fullRescan: false };
  }

  const byPath = new Map(prev.entries.map((e) => [e.path, e] as const));
  const adopted: string[] = [];
  let setChanged = false; // an add/remove/uuid/type change — path resolution is global

  for (const content of contentPaths) {
    const abs = path.join(root, content);
    const before = byPath.get(content);
    // Reprocess the content path's CURRENT disk state — this one branch covers a
    // content edit, a `.meta` edit, orphan adoption, and deletion (the same states
    // a full scan resolves per file).
    if (!existsSync(abs)) {
      if (before) { byPath.delete(content); setChanged = true; }
      continue;
    }
    if (!existsSync(abs + META_EXT)) {
      // Orphan content with no sidecar: a full scan would mint one this pass
      // (unknown extensions are left alone). Mirror that so it enters the index now.
      if ((await adoptOrphan(abs)) === 'adopted') adopted.push(content);
      else { if (before) { byPath.delete(content); setChanged = true; } continue; }
    }
    let meta: { uuid?: unknown; type?: unknown; importer?: unknown };
    try {
      meta = JSON.parse(await readTextInRoot(abs + META_EXT));
    } catch {
      continue; // unreadable/partial .meta — a later event will settle it
    }
    if (typeof meta.uuid !== 'string' || typeof meta.type !== 'string') continue;
    const entry: AssetEntry = {
      uuid: meta.uuid.toLowerCase(),
      path: content,
      type: meta.type,
      importer: (meta.importer as Record<string, unknown>) ?? {},
    };
    if (!before || before.uuid !== entry.uuid || before.type !== entry.type) setChanged = true;
    byPath.set(content, entry);
  }

  const entries = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  // Here too, and here MOST: a folder of assets dropped in with their sidecars
  // arrives through the watcher, which is exactly where duplicate uuids come from.
  // Before deps, which are keyed by uuid.
  const warnings: string[] = [];
  const reminted = await resolveDuplicateUuids(root, entries, warnings);
  if (reminted.length > 0) setChanged = true;

  // Deps: when the entry SET changed, path + bare-uuid resolution is global, so
  // recompute the whole graph from the new entries (still bounded to ref-carrying
  // assets — far fewer than every `.meta`). When only existing assets' CONTENT
  // changed, other assets' edges can't have moved: patch just the touched
  // ref-assets over the previous graph.
  let deps: Record<string, string[]>;
  if (setChanged) {
    const r = await computeDeps(root, entries);
    deps = r.deps;
    warnings.push(...r.warnings);
  } else {
    deps = { ...prev.deps };
    const touched = entries.filter((e) => contentPaths.has(e.path));
    for (const e of touched) delete deps[e.uuid]; // clear stale before recompute
    const r = await computeDeps(root, entries, touched);
    Object.assign(deps, r.deps);
    warnings.push(...r.warnings);
  }

  const index: AssetIndex = { version: '1.0', entries, deps };
  const outputPath = opts?.write !== false ? await writeIndexIfChanged(root, index) : null;
  return { ok: true, outputPath, index, warnings, adopted, reminted, fullRescan: false };
}
