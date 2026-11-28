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
import { readFile, writeFile, mkdir, readdir, stat, rename } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { existsSync, realpath } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { readManifest, readTextInRoot } from '../project/readProject';
import { PROJECT_MANIFEST_FILE } from '../project/format';
import { isInsideRoot } from '../fs/pathSandbox';
import { META_EXT, isContentDir, isContentFile, isExcludedByProject, isNonContentPath } from './contentPolicy';
import { adoptOrphan, metaTypeForFile } from './assetMeta';
import { canonicalMetaType, metaTypeForExt } from '../../../tools/assetMetaTable.js';
// The runtime's tileset-path resolver (a dependency-free leaf) — shared so the dep scan
// discovers a tilemap's tileset images the same way the loader will later request them.
import { findDocumentAsset, isFileAssetRef, matchesAssetFieldType, resolveDocumentRef } from '../../../sdk/src/asset/documentRef';
import { bitmapFontMetricsField, type BitmapFontDocument } from '../../../sdk/src/asset/bitmapFontDocument';
import { registeredAssetFields } from '../../../sdk/src/asset/registeredAssetFields';
import { visitAnimatorClips } from './animatorRefs';
import { mapMaterialRefs } from './materialRefs';
import { assetRefId, localAssetPathWithoutSuffix, UUID_REF_PREFIX, UUID_V4_REGEX as UUID_V4 } from '../../../sdk/src/asset/AssetRegistry';
import { resolveMeshGI } from '../../../sdk/src/gi/meshGIAssets';
// The spine-atlas page parser (a dependency-free leaf) — shared with the runtime loaders
// so the dep scan discovers an atlas's texture pages the same way they will be requested.
import { parseSpineAtlasPages } from '../../../sdk/src/spine/atlasPages';
import { someRichTextImageRef } from './sceneRichTextRefs';
import { getEditorType } from '../../../sdk/src/assetTypes';
import { isTextureRecipePath } from '../../../sdk/src/asset/textureRecipePath';
import { parseTerrainTiles, terrainTileImageRefs } from '../../../sdk/src/terrain/tileDocument';
import { mapGroomAssetRefs } from '../../../sdk/src/groom/groomFormat';
import { isSoundEventPath, mapSoundEventClipRefs } from '../../../sdk/src/audio/soundEventRefs';

/** Local, gitignored cache inside the project (next to workspace.json). */
const CACHE_DIR = '.esengine/cache';
const OUTPUT = 'assets.json';

/** One asset: stable uuid, current project-relative path, type + importer settings. */
export interface AssetEntry {
  uuid: string;
  path: string;
  type: string;
  importer?: Record<string, unknown>;
  labels?: string[];
  /** The uuid of the asset an import made this from (a model's mesh, material, clip, prefab): `source` in its `.meta`. */
  source?: string;
}

interface AssetMetaFields {
  uuid?: unknown;
  type?: unknown;
  importer?: unknown;
  source?: unknown;
  labels?: unknown;
}

function entryFromMeta(path: string, meta: AssetMetaFields | null): AssetEntry | undefined {
  if (typeof meta?.uuid !== 'string' || typeof meta.type !== 'string') return undefined;
  const labels = new Set<string>();
  if (Array.isArray(meta.labels)) {
    for (const raw of meta.labels) {
      const label = typeof raw === 'string' ? raw.trim() : '';
      if (label) labels.add(label);
    }
  }
  return {
    uuid: meta.uuid.toLowerCase(), path, type: canonicalMetaType(meta.type),
    importer: (meta.importer as Record<string, unknown>) ?? {},
    ...(typeof meta.source === 'string' ? { source: meta.source.toLowerCase() } : {}),
    ...(labels.size ? { labels: [...labels] } : {}),
  };
}

async function readIndexEntry(root: string, metaRel: string): Promise<{ entry: AssetEntry } | { warning: string }> {
  let meta: AssetMetaFields | null;
  try {
    meta = JSON.parse(await readTextInRoot(path.join(root, metaRel)));
  } catch (err) {
    return { warning: `${metaRel}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const entry = entryFromMeta(metaRel.slice(0, -META_EXT.length), meta);
  return entry ? { entry } : { warning: `${metaRel}: missing uuid or type` };
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
  /** The content filter used to build this index. Older caches omitted it. */
  assetExclude?: string[];
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
  for (const [index, entry] of entries.entries()) {
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
    entries[index] = { ...entry, uuid: fresh };
    owner.set(fresh, entry.path);
    reminted.push(entry.path);
  }
  return reminted;
}

/**
 * A directory entry that leaves the project through a link — never indexed. The
 * cook reads every indexed path and writes what it reads into the shipped game,
 * and a project is not trusted input. A link that stays inside is an ordinary
 * file here, and only links pay the realpath call.
 */
function leavesProject(root: string, dirent: Dirent, parent: string): boolean {
  return dirent.isSymbolicLink() && !isInsideRoot(root, path.join(parent, dirent.name));
}

/** Recursively yield the sidecars of present content files, with project-relative forward slashes. */
async function* walkMeta(root: string, rel = '', exclude?: readonly string[]): AsyncGenerator<string> {
  const abs = rel ? path.join(root, rel) : root;
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return; // unreadable dir
  }
  const escaped = new Set<string>(), files = new Set<string>();
  const fileKey = (name: string) => process.platform === 'win32' ? name.toLowerCase() : name;
  for (const e of entries) {
    if (leavesProject(root, e, abs)) escaped.add(e.name);
    else if (!e.isDirectory()) files.add(fileKey(e.name));
  }
  for (const e of entries) {
    if (escaped.has(e.name)) continue;
    if (e.isDirectory()) {
      if (!isContentDir(e.name)) continue;
      if (isExcludedByProject(rel ? `${rel}/${e.name}` : e.name, exclude)) continue;
      yield* walkMeta(root, rel ? `${rel}/${e.name}` : e.name, exclude);
    } else if (e.name.endsWith(META_EXT)) {
      // A sidecar may survive deletion or a partial import. Only content present inside the project can satisfy a reference.
      if (!files.has(fileKey(e.name.slice(0, -META_EXT.length)))) continue;
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
async function adoptOrphans(root: string, rel = '', adopted: string[] = [], exclude?: readonly string[]): Promise<string[]> {
  const abs = rel ? path.join(root, rel) : root;
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return adopted; // unreadable dir
  }
  // A regular sidecar with the exact name is already known to exist from readdir.
  // Case variants and links still go through adoptOrphan's filesystem checks.
  const sidecars = new Set<string>();
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(META_EXT)) sidecars.add(e.name);
  }
  for (const e of entries) {
    if (leavesProject(root, e, abs)) continue;
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!isContentDir(e.name)) continue;
      if (isExcludedByProject(relPath, exclude)) continue;
      await adoptOrphans(root, relPath, adopted, exclude);
    } else if (isContentFile(e.name) && !sidecars.has(e.name + META_EXT)) {
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

// A bitmap font is the same shape one step over: TEXT, naming its page image as a
// sibling, and nothing else in the project names that image either.
const FNT_PAGE = /(?:^|\n)\s*page\b[^\n]*\bfile="([^"]+)"/g;
const BITMAP_FONT = metaTypeForExt('.fnt');

// 'json' is a game's own data table. It is scanned like the rest because a
// data-driven game names assets FROM its data — a spawn table holding `@uuid:`
// refs is the ordinary way to do that — and an unscanned table means the cook
// culls what only it points at, which surfaces as a missing asset in the build
// and nowhere else.
// 'environment' names its reflection atlas and 'animatorcontroller' the clips its
// states play — both the skeletal-atlas shape, where the only reference lives
// inside a document, so an unscanned type 404s what the document needs.
const JSON_REF_TYPES = new Set([
  'scene', 'prefab', 'material', 'tileset', 'tilemap', 'animclip', 'animation', 'statemachine', 'behaviortree',
  'scriptgraph',
  'environment', 'animatorcontroller', 'avatar',
  'json', 'sound-event', 'world-rules', 'terrain-layer', 'terrain-layer-info', 'physical-material', 'terrain-tiles',
  // A groom names its curves file beside it, and each group its material.
  'groom',
]);

const isTextureRecipe = (e: { type: string; path: string }): boolean => e.type === 'imageSource' && isTextureRecipePath(e.path);
/** A clip that is a recipe names the recordings it plays (a sampled instrument's notes, a sample layer's file). */
const isAudioRecipe = (e: { type: string }): boolean => e.type === 'soundSource' || e.type === 'musicSource';

type RegisteredComponent = keyof typeof registeredAssetFields;
type RegisteredSlot = (typeof registeredAssetFields)[RegisteredComponent];
interface NamedCandidate { ref: string; component: RegisteredComponent }
type RefCandidate = string | NamedCandidate;

/** The parsed copy belongs to this scan. Move the value out so the generic string walk cannot count it a second time. */
function takeNamedCandidate(holder: Record<string, unknown>, key: string, component: RegisteredComponent, into: NamedCandidate[]): void {
  const ref = holder[key];
  if (typeof ref !== 'string') return;
  if (ref) into.push({ component, ref });
  delete holder[key];
}

/** Resolve UUIDs and paths against the project index, retaining the slot type for dual-purpose fields. */
function resolveCandidate(candidate: RefCandidate, resolvePath: (ref: string, slot?: RegisteredSlot) => string | null, known: ReadonlyMap<string, AssetEntry>): string | null {
  const ref = typeof candidate === 'string' ? candidate : candidate.ref;
  const id = assetRefId(ref);
  if (id === null) return resolvePath(ref, typeof candidate === 'string' ? undefined : registeredAssetFields[candidate.component]);
  // Preserve missing explicit UUID edges for diagnostics. A bare scene entity ID is not an asset.
  return known.has(id) || (ref.startsWith(UUID_REF_PREFIX) && UUID_V4.test(id)) ? id : null;
}

/**
 * What a document can refer to by name, before any of it is resolved: its `@uuid:` strings, its bare uuids and the strings that could be file paths.
 * This is what reading and parsing a document finds; which of them are assets is a question of the rest of the project, asked again on every scan.
 */
function collectCandidates(value: unknown, into: Set<string>, documentType: string, named: NamedCandidate[]): void {
    if (typeof value === 'string') {
        if (assetRefId(value) || (!value.includes('://') && PATH_LIKE.test(value))) into.add(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const v of value) collectCandidates(v, into, documentType, named);
        return;
    }
    if (value && typeof value === 'object') {
        const row = value as {
            type?: string; data?: Record<string, unknown>;
            componentType?: string; propertyName?: string; value?: unknown;
        };
        if (documentType === 'scene' || documentType === 'prefab') {
            const component = row.type === 'property' ? row.componentType : row.type;
            if (component && Object.hasOwn(registeredAssetFields, component)) {
                const name = component as RegisteredComponent;
                const key = registeredAssetFields[name].field;
                if (row.type === 'property' && row.propertyName === key) takeNamedCandidate(row, 'value', name, named);
                else if (row.data && row.type === name) takeNamedCandidate(row.data, key, name, named);
            }
        }
        someRichTextImageRef(row, documentType, ref => { collectCandidates(ref, into, documentType, named); return false; });
        for (const v of Object.values(value)) collectCandidates(v, into, documentType, named);
    }
}

/** Reuse candidates while the file stamp matches, including edits that preserve mtime. */
const CANDIDATE_CACHE_VERSION = 11;
interface CandidateCache { version: number; files: Record<string, { size: number; mtimeMs: number; ctimeMs: number; type: string; c: RefCandidate[] }> }
const CANDIDATE_CACHE_FILE = path.join('.esengine', 'cache', 'ref-candidates.json');

async function readCandidateCache(root: string): Promise<CandidateCache> {
  try {
    const parsed = JSON.parse(await readFile(path.join(root, CANDIDATE_CACHE_FILE), 'utf8')) as CandidateCache;
    if (parsed.version === CANDIDATE_CACHE_VERSION && parsed.files) return parsed;
  } catch { /* none yet, or one that cannot be read: the documents are read */ }
  return { version: CANDIDATE_CACHE_VERSION, files: {} };
}

async function writeCandidateCache(root: string, cache: CandidateCache): Promise<void> {
  try {
    const file = path.join(root, CANDIDATE_CACHE_FILE);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(cache), 'utf8');
    await rename(tmp, file);
  } catch { /* a cache that cannot be written costs the next scan its reads */ }
}

/**
 * Whether a string could name a file: it ends in an extension. Almost every string in a document is a name, a type or
 * a label (`Transform`, `Cocos.Widget`, `ui_layer`), and each one asked of the path index costs a normalisation and a lookup; in a project of
 * thousands of documents those are most of the scan.
 */
const PATH_LIKE = /\.[a-z0-9]{1,16}(?:[?#].*)?$/i;

const SIBLING_REF_TYPES = new Set(['material', 'environment', 'animatorcontroller']);

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
  onProgress?: (progress: ScanProgress) => void,
): Promise<{ deps: Record<string, string[]>; warnings: string[] }> {
  const refEntries = (targets ?? entries).filter(
    // A texture that is a recipe names what it is drawn from: the pictures it lays in, its font files, the picture it is a map of.
    (e) => JSON_REF_TYPES.has(e.type) || e.type === BITMAP_FONT || e.type === 'mesh' || isTextureRecipe(e) || isAudioRecipe(e) || isSoundEventPath(e.path)
      || SKELETAL_ATLAS_TYPES.has(getEditorType(e.path)),
  );
  // A content-only edit to an ordinary texture or audio file cannot introduce
  // outbound references. A full scan still prunes cache entries for removed files.
  if (targets && refEntries.length === 0) return { deps: {}, warnings: [] };
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const byKey = new Map(entries.map(e => [e.uuid, e]));
  type DepResult = { uuid: string; refs: string[] } | { warning: string };
  // Reading one changed document is cheaper than loading and rewriting the whole
  // cache. Full scans still refresh its entries using the on-disk file stamps.
  const cache = targets && refEntries.length === 1 ? null : await readCandidateCache(root);
  let cacheDirty = false;
  const seenFiles = new Set<string>();
  const candidatesOf = async (rel: string, type: string, parse: (text: string) => RefCandidate[]): Promise<RefCandidate[]> => {
    const file = path.join(root, rel);
    if (!cache) return parse(await readTextInRoot(file));
    seenFiles.add(rel);
    const info = await stat(file);
    const hit = cache.files[rel];
    if (hit && hit.type === type && hit.size === info.size && hit.mtimeMs === info.mtimeMs && hit.ctimeMs === info.ctimeMs) return hit.c;
    const c = parse(await readTextInRoot(file));
    cache.files[rel] = { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, type, c };
    cacheDirty = true;
    return c;
  };
  const jsonCandidates = (rel: string, type: string, text: string, bitmapWrapper: boolean): RefCandidate[] => {
    const json = JSON.parse(text);
    if (bitmapWrapper) {
      const wrapper = json as BitmapFontDocument | null;
      const metrics = wrapper?.[bitmapFontMetricsField(wrapper)];
      return typeof metrics === 'string' && metrics ? [metrics] : [];
    }
    const found = new Set<string>();
    const named: NamedCandidate[] = [];
    if (type === 'animatorcontroller') visitAnimatorClips(json, (kind, holder) => {
      if (kind === 'sprite' || kind === 'timeline') takeNamedCandidate(holder, 'clip', kind === 'sprite' ? 'SpriteAnimator' : 'TimelinePlayer', named);
    });
    if (type === 'terrain-tiles') {
      for (const ref of terrainTileImageRefs(parseTerrainTiles(json, rel))) found.add(ref);
    } else if (type === 'material') {
      mapMaterialRefs(json, ref => {
        if (assetRefId(ref) || !/^[a-z][a-z0-9+.-]*:/i.test(ref)) found.add(ref);
        return ref;
      });
    } else if (type === 'groom') {
      mapGroomAssetRefs(json, ref => { found.add(ref); return ref; });
    } else if (type === 'sound-event' || isSoundEventPath(rel)) {
      mapSoundEventClipRefs(json, ref => { found.add(ref); return ref; });
    } else {
      collectCandidates(json, found, type, named);
    }
    return [...found, ...named];
  };
  const dependenciesOf = async (entry: AssetEntry): Promise<DepResult> => {
    // A spine `.atlas` is a TEXT manifest (not JSON): its page image names are
    // texture deps — the same edge the SpineAssetLoader walks at runtime. Scan it
    // apart from the JSON path so the cook embeds those textures (else the atlas
    // ships but its .png is culled and the playable 404s it).
    // Spine's atlas is a TEXT manifest and needs its own parser; DragonBones'
    // is JSON, so the generic walk below already finds its `imagePath`.
    const editorType = getEditorType(entry.path);
    const isSpineAtlas = editorType === 'spine-atlas';
    const isBitmapFont = entry.type === BITMAP_FONT;
    const bitmapWrapper = isBitmapFont && path.extname(entry.path).toLowerCase() === '.bmfont';
    // These loaders resolve against the document without guessing a project-relative address.
    const documentRelative = bitmapWrapper || entry.type === 'groom';
    const preferSibling = isBitmapFont || SKELETAL_ATLAS_TYPES.has(editorType)
      || SIBLING_REF_TYPES.has(entry.type) || /\.(?:tmj|tmx|tsj)$/i.test(entry.path);
    const lookup = (ref: string, slot?: RegisteredSlot) => {
      if (documentRelative) {
        const logical = resolveDocumentRef(entry.path, ref).replace(/^\//, '');
        return byPath.get(logical) ?? byPath.get(localAssetPathWithoutSuffix(logical));
      }
      const explicit = slot && isFileAssetRef(ref, slot.fileExtension);
      return findDocumentAsset(entry.path, ref, file => {
        const target = byPath.get(file);
        return !slot || explicit || matchesAssetFieldType(target?.type, slot.type) ? target : undefined;
      }, preferSibling ? 'document' : 'project');
    };
    const pageAsset = (ref: string) => {
      const id = assetRefId(ref);
      return id === null ? lookup(ref) : byKey.get(id);
    };
    try {
      const refs = new Set<string>();
      if (entry.type === 'mesh') {
        // New imports select one complete bake. Older loose meshes may use the typed pair beside them.
        const pair = resolveMeshGI(entry.path, entry.importer?.meshGI, (ref, type) => {
          const dep = byKey.get(ref.replace(/^@uuid:/, '').toLowerCase()) ?? byPath.get(ref);
          return dep?.type === type ? dep.uuid : undefined;
        });
        if (pair) { refs.add(pair.sdf); refs.add(pair.cards); }
      } else if (isBitmapFont && !bitmapWrapper) {
        const pages = await candidatesOf(entry.path, entry.type, content => Array.from(content.matchAll(FNT_PAGE), match => match[1]));
        for (const page of pages) {
          const dep = typeof page === 'string' ? pageAsset(page) : undefined;
          if (dep) refs.add(dep.uuid);
        }
      } else if (isSpineAtlas) {
        const content = await readTextInRoot(path.join(root, entry.path));
        for (const page of parseSpineAtlasPages(content)) {
          const dep = pageAsset(page);
          if (dep) refs.add(dep.uuid);
        }
      } else {
        const candidates = await candidatesOf(entry.path, entry.type, text => jsonCandidates(entry.path, entry.type, text, bitmapWrapper));
        const resolvePath = (ref: string, slot?: RegisteredSlot): string | null => {
          if (ref.includes('://')) return null;
          return lookup(ref, slot)?.uuid ?? null;
        };
        for (const candidate of candidates) {
          const id = resolveCandidate(candidate, resolvePath, byKey);
          if (id) refs.add(id);
        }
      }
      refs.delete(entry.uuid);
      return { uuid: entry.uuid, refs: [...refs].sort() };
    } catch (err) {
      return { warning: `${entry.path}: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
  let finished = 0;
  const depResults = await mapLimit(refEntries, SCAN_IO_CONCURRENCY, async (entry): Promise<DepResult> => {
    // Counted as each document is done, whichever way it ends.
    try { return await dependenciesOf(entry); } finally { onProgress?.({ phase: 'references', done: ++finished, total: refEntries.length }); }
  });
  // A full scan forgets the documents that are gone; one of some documents only (`targets`) leaves the rest as they are.
  if (cache) {
    if (!targets) for (const rel of Object.keys(cache.files)) if (!seenFiles.has(rel)) { delete cache.files[rel]; cacheDirty = true; }
    if (cacheDirty) await writeCandidateCache(root, cache);
  }
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
        ...(Array.isArray(raw.assetExclude) && raw.assetExclude.every((v: unknown) => typeof v === 'string')
          ? { assetExclude: raw.assetExclude as string[] } : {}),
      };
    }
  } catch {
    // missing or malformed — caller falls back to a full scan
  }
  return null;
}

/** A canonical list so reordering equivalent manifest entries does not invalidate the index. */
async function excludedFolders(root: string): Promise<string[]> {
  try {
    return [...new Set((await readManifest(root)).assetExclude ?? [])].sort();
  } catch {
    return [];
  }
}

/** Check candidate paths against the same files a scan would index, without adopting or walking the project. */
export function projectAssetPathProbe(root: string): (rel: string) => Promise<boolean> {
  const results = new Map<string, Promise<boolean>>();
  const directories = new Map<string, Promise<string[]>>();
  let exclude: Promise<string[]> | undefined;
  async function exists(rel: string): Promise<boolean> {
    const file = path.posix.basename(rel);
    if (!isContentFile(file) || isNonContentPath(rel, await (exclude ??= excludedFolders(root)))) return false;
    const abs = path.resolve(root, rel);
    if (!isInsideRoot(root, abs)) return false;
    const folder = path.dirname(abs);
    let listing = directories.get(folder);
    if (!listing) {
      listing = readdir(folder).catch(() => []);
      directories.set(folder, listing);
    }
    const names = await listing;
    const hasMeta = names.includes(file + META_EXT);
    if ((!hasMeta && !names.includes(file)) || !(await stat(abs).catch(() => null))?.isFile()) return false;
    if (hasMeta) {
      if (!isInsideRoot(root, abs + META_EXT)) return false;
      return 'entry' in await readIndexEntry(root, rel + META_EXT);
    }
    return rel !== 'thumbnail.png' && (await metaTypeForFile(abs)) !== null;
  }
  return rel => {
    let result = results.get(rel);
    if (!result) {
      result = exists(rel);
      results.set(rel, result);
    }
    return result;
  };
}

/** How far a scan is: the step it is in and how many of that step's items are done. */
export interface ScanProgress { phase: 'references'; done: number; total: number }

/**
 * Scan `root` for `.meta` sidecars → build the asset index (registry + dep
 * graph) and (unless `write: false`) write `.esengine/cache/assets.json`.
 */
export async function scanAssetDatabase(
  root: string,
  opts?: { write?: boolean; adopt?: boolean; onProgress?: (progress: ScanProgress) => void },
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
  const exclude = await excludedFolders(root);
  const adopted = opts?.adopt === false ? [] : await adoptOrphans(root, '', [], exclude);
  t.adopt = performance.now() - tStart;

  const tWalk = performance.now();
  // The generator walk is just readdir (cheap); the readFile+parse per .meta is
  // the cost — run those in parallel, then assemble deterministically in order.
  const metaRels: string[] = [];
  for await (const metaRel of walkMeta(root, '', exclude)) metaRels.push(metaRel);
  const walkResults = await mapLimit(metaRels, SCAN_IO_CONCURRENCY, metaRel => readIndexEntry(root, metaRel));
  for (const r of walkResults) {
    if ('entry' in r) entries.push(r.entry);
    else warnings.push(r.warning);
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  // Sorted FIRST: which file keeps a shared uuid has to be the same answer on every
  // machine and every re-scan, and path order is the only stable one here.
  const reminted = await resolveDuplicateUuids(root, entries, warnings);
  t.walk = performance.now() - tWalk;

  const tDeps = performance.now();
  opts?.onProgress?.({ phase: 'references', done: 0, total: entries.length });
  const { deps, warnings: depWarnings } = await computeDeps(root, entries, undefined, opts?.onProgress);
  warnings.push(...depWarnings);

  t.deps = performance.now() - tDeps;
  const index: AssetIndex = { version: '1.0', entries, deps, assetExclude: exclude };

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

const nativeRealpath = promisify(realpath.native);

/** Windows may open either spelling. A full scan indexes the spelling of the sidecar itself. */
async function hasDifferentSidecarCase(root: string, sidecar: string): Promise<boolean> {
  try {
    const physical = (await nativeRealpath(path.join(root, sidecar))).replace(/\\/g, '/');
    const suffix = `/${sidecar}`;
    return physical.toLowerCase().endsWith(suffix.toLowerCase()) && !physical.endsWith(suffix);
  } catch {
    return false;
  }
}

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
  const exclude = await excludedFolders(root);
  const previousExclude = prev.assetExclude;
  if (!previousExclude || previousExclude.length !== exclude.length || previousExclude.some((folder, i) => folder !== exclude[i])) {
    return full('asset exclusions changed');
  }

  // The content paths touched (strip `.meta` pairing; dedup — a texture edit fires
  // both foo.png and foo.png.meta). Skip plumbing paths + the editor-managed cover.
  const contentPaths = new Set<string>();
  for (const raw of changed) {
    const rel = raw.replace(/\\/g, '/');
    if (rel === PROJECT_MANIFEST_FILE || isNonContentPath(rel, exclude)) continue;
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
  const warnings: string[] = [];
  // An ADD or a uuid/type change makes path + bare-uuid resolution global again —
  // a ref that used to dangle can now land. A REMOVAL cannot do that, so the two
  // are tracked apart; see the deps branch below for what each costs.
  let resolutionChanged = false;
  const addedUuids = new Set<string>();
  const removedUuids = new Set<string>();
  const drop = (entry: AssetEntry | undefined, content: string): void => {
    if (!entry) return;
    byPath.delete(content);
    removedUuids.add(entry.uuid);
  };

  for (const content of contentPaths) {
    const abs = path.join(root, content);
    const before = byPath.get(content);
    // Reprocess the content path's CURRENT disk state — this one branch covers a
    // content edit, a `.meta` edit, orphan adoption, and deletion (the same states
    // a full scan resolves per file).
    if (!existsSync(abs)) {
      drop(before, content);
      continue;
    }
    if (!existsSync(abs + META_EXT)) {
      // Orphan content with no sidecar: a full scan would mint one this pass
      // (unknown extensions are left alone). Mirror that so it enters the index now.
      if ((await adoptOrphan(abs)) === 'adopted') adopted.push(content);
      else { drop(before, content); continue; }
    }
    const sidecar = content + META_EXT;
    if (process.platform === 'win32' && !before) {
      const folded = content.toLowerCase();
      if (prev.entries.some(entry => entry.path.toLowerCase() === folded)) return full(`asset path changed case (${content})`);
    }
    const [result, caseChanged] = await Promise.all([
      readIndexEntry(root, sidecar),
      process.platform === 'win32' && hasDifferentSidecarCase(root, sidecar),
    ]);
    if (caseChanged) return full(`asset path changed case (${content})`);
    if ('warning' in result) {
      warnings.push(result.warning);
      drop(before, content);
      continue;
    }
    const { entry } = result;
    if (before?.uuid !== entry.uuid) addedUuids.add(entry.uuid);
    if (!before || before.uuid !== entry.uuid || before.type !== entry.type || before.source !== entry.source) resolutionChanged = true;
    byPath.set(content, entry);
  }

  // A watcher can report only the destination of a move. Confirm that the
  // previous owner of an incoming UUID still exists before repairing a duplicate.
  if (addedUuids.size > 0) {
    for (const entry of prev.entries) {
      if (!addedUuids.has(entry.uuid) || byPath.get(entry.path) !== entry) continue;
      const file = path.join(root, entry.path);
      if (!existsSync(file) || !existsSync(file + META_EXT)) return full(`asset identity moved (${entry.path})`);
    }
  }

  const entries = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  // Here too, and here MOST: a folder of assets dropped in with their sidecars
  // arrives through the watcher, which is exactly where duplicate uuids come from.
  // Before deps, which are keyed by uuid.
  const reminted = await resolveDuplicateUuids(root, entries, warnings);
  if (reminted.length > 0) resolutionChanged = true;

  // Deps: recomputing the whole graph means READING AND PARSING every ref-carrying
  // asset in the project — a second or more once a project has a few thousand, and
  // the main process is blocked throughout. So it is reserved for the case that
  // needs it: an ADDED entry (or a re-minted uuid, or a changed type) makes path +
  // bare-uuid resolution global again, because a reference that used to resolve to
  // nothing may now land somewhere.
  //
  // A REMOVAL cannot move an edge that isn't already pointing at what left: for
  // every other document the same paths and uuids resolve the same way. So the
  // patch set is the touched files plus whoever referenced something removed —
  // those must be re-read, since a path or bare-uuid ref to a gone asset stops
  // being an edge (an `@uuid:` one does not, and re-reading is how we tell).
  let deps: Record<string, string[]>;
  if (resolutionChanged) {
    const r = await computeDeps(root, entries);
    deps = r.deps;
    warnings.push(...r.warnings);
  } else {
    deps = { ...prev.deps };
    const reresolve = new Set<string>();
    for (const uuid of removedUuids) delete deps[uuid];
    if (removedUuids.size > 0) {
      for (const [uuid, refs] of Object.entries(deps)) {
        if (refs.some((r) => removedUuids.has(r))) reresolve.add(uuid);
      }
    }
    const touched = entries.filter((e) => contentPaths.has(e.path) || reresolve.has(e.uuid));
    for (const e of touched) delete deps[e.uuid]; // clear stale before recompute
    const r = await computeDeps(root, entries, touched);
    Object.assign(deps, r.deps);
    warnings.push(...r.warnings);
  }

  const index: AssetIndex = { version: '1.0', entries, deps, assetExclude: exclude };
  const outputPath = opts?.write !== false ? await writeIndexIfChanged(root, index) : null;
  return { ok: true, outputPath, index, warnings, adopted, reminted, fullRescan: false };
}
