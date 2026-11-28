// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Asset cook (REARCH_ASSETS.md A4). Produce a shippable asset set: from
 *        the entry scene(s), walk the AssetDatabase dependency graph to the
 *        REACHABLE assets, copy those files into an output dir (project-relative
 *        paths preserved), and emit the runtime `assets.manifest.json` (the
 *        shape `AssetRegistry.loadManifest` consumes). Assets nothing references
 *        are culled from the build.
 *
 * Reuses the A2 scanner (scanAssetDatabase) for the index + dep graph, so the
 * editor's resolution, the Content Browser, and the ship cook all read one
 * source of truth. Pure Node (fs), no Electron imports → unit-testable; IPC
 * wiring is in main.ts.
 *
 * Deferred (per-target work): transcode/compress per platform (web/wechat/
 * native), texture atlasing, and the full web-build (html + runtime + scripts).
 * This is the reachability + manifest + staging core they all build on.
 */
import { MODEL_BAKES_FILE, bakesAtLoad, modelProductPaths, type ModelBakesFile, type ModelProductRole } from '../modeling/loadBakeFile';
import { ENV_IMAGE_FIELDS } from './environmentFormat';
import { writeFile, mkdir, readFile, open } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { isInsideRoot } from '../fs/pathSandbox';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanAssetDatabase, type AssetEntry } from './assetDb';
import { packAtlas, decodePngImage, encodePagePng, type AtlasInputImage } from './atlasPacker';
import { atlasTextureSettingsKey, textureImportSettingsFrom } from '../../../sdk/src/asset/textureImportSettings';
// Per-asset texture cook settings (compress opt-out / format / size cap), read
// from the `.meta` `importer` block — the same registry the inspector edits, so a
// texture's ship-time compression is authored per asset, not one global switch.
import { readTextureCookSettings, textureUse } from '../project/importSettings';
import { audioLoadTypeOf } from './audioCook';
// The compression a build gives one texture, and the one reason it is that.
// The branch below IS this function — a cook that re-derived the choice would
// be a second answer to the question an inspector asks before a build runs.
import {
  decideTextureCook, cookIntentDefeated, explainTextureCook, textureAsksCompression,
  type TextureCookDecision,
} from './textureCookDecision';
// Single-source content hash (sdk/src/asset/contentHash.ts). Imported as source —
// no hand-mirrored copy — so the cook and the runtime agree by construction.
import { contentHashHex } from '../../../sdk/src/asset/contentHash';
import { getAssetTypeEntry } from '../../../sdk/src/assetTypes';
import { animatorMotionFile, findDocumentAsset, resolveDocumentRef } from '../../../sdk/src/asset/documentRef';
import { bitmapFontMetricsField, type BitmapFontDocument } from '../../../sdk/src/asset/bitmapFontDocument';
import { assetRefId } from '../../../sdk/src/asset/AssetRegistry';
import { parseTerrainTiles, terrainTileImageRefs, terrainTileSizeError } from '../../../sdk/src/terrain/tileDocument';
import { requireSupportedSceneDocument, requireUnambiguousSceneHierarchy } from '../../../sdk/src/scene/sceneFormat';
import type { SceneData } from '../../../sdk/src/scene/scene';
import { addressableKeys } from './addressableRecord';
import { visitAnimatorClips } from './animatorRefs';
import { mapMaterialRefs } from './materialRefs';
import { mapTilesetImages } from '../../../sdk/src/tilemap/tiledRefs';
import { parseTiledMapDocument, validateTiledTileData } from '../../../sdk/src/tilemap/tiledData';
// Single source for the folder→delivery-group model, shared with the editor Play
// realm (sdk/src/asset/assetGroups.ts) so cook and editor never disagree.
import { resolveAssetGroup, resolveAtlas, type AssetGroupsConfig } from '../../../sdk/src/asset/assetGroups';
import type { AssetPackRef, BundleMode, StreamTailInfo } from '../../../sdk/src/asset/AddressableManifest';
import {
  readKtx2Layout, wantsMipChain, halveRgba, spliceMipChain,
} from './ktx2Mips';
import { cookCached } from './cookCache';
import { cookTexture, loadTextureEncoder, needsLosslessTextureCook, pngDimensions, fillClearTexels, fillsClearTexels, COMPRESSED_TARGETS, type BasisEncoderModule } from './textureCook';
import { meshTextureRoles } from './textureUsage';
import { makeStreamTail, type StreamTail } from './streamTail';
import { matchScriptAssetRefs, scanScriptAssetRefs, unregisteredScriptRefs } from './scriptAssetRefs';
import { metaTypeFor } from './assetMeta';
import { META_EXT } from './contentPolicy';
import { maxBonesFor } from '../project/skinning';
import { MESH_MAX_BONES } from '../../../sdk/src/asset/meshFormat';
import { fitSkinToBudget } from '../../../sdk/src/asset/skinChunks';
import { readManifest } from '../project/readProject';
import { resolveScripts } from '../project/format';

const MANIFEST = 'assets.manifest.json';

/**
 * One cooked asset in the ship manifest. Extends the DB index entry with the
 * physical-identity fields it needs: `contentHash` (XXH64 of the staged bytes)
 * and `size`. The runtime AssetRegistry consumes the same v1.0 manifest and
 * simply ignores these extra fields (it maps uuid→path); the AddressableManifest
 * and content-addressed naming are what read them.
 */
/** How an addressable group is delivered — the typed mode {@link resolveAssetGroup}
 *  assigns and the AddressableManifest carries. Alias of the SDK's BundleMode:
 *  `local` (main package), `lazy` (subpackage), `remote` (CDN / hot-update). */
export type GroupDelivery = BundleMode;

export interface CookManifestEntry extends AssetEntry {
  /** XXH64 (16 hex) of the exact bytes staged — the asset's physical identity. */
  contentHash: string;
  /** Staged byte length. */
  size: number;
  /**
   * The asset's LOGICAL project-relative path — its addressable identity, kept
   * even when content-addressed staging renames the physical file (`path`) or
   * texture encoding swaps its extension. This is what path-style references
   * (a scene's "assets/x.esmaterial", a material's relative "x.esshader")
   * name at runtime; a host maps it to `path` to serve them from a cooked build.
   */
  sourcePath: string;
  /** GPU formats the staged KTX2 can transcode to, when the asset was compressed. */
  compressedFormats?: string[];
  /**
   * The small copy of a texture a mesh draws (streamTail.ts), staged beside it: what texture streaming fetches first, so the full
   * file is downloaded only once a view needs it. `width`/`height` are the copy's, `fullWidth`/`fullHeight` the file's.
   */
  streamTail?: StreamTailInfo;
  /** Added to the flat manifest when the export places these bytes in an asset pack. */
  pack?: AssetPackRef;
  /**
   * What this build did to the texture's compression request, for images only.
   *
   * `compressedFormats` says a payload can transcode; it cannot say why one is
   * absent, and a request defeated by the image's own dimensions and one
   * defeated by the Build dialog are fixed in different places.
   */
  cook?: TextureCookDecision;
  /**
   * Addressable group this asset belongs to. `'main'` ships in the main package
   * (loaded eagerly); any other name is a lazy subpackage (folder convention:
   * `subpackages/<name>/…` → group `<name>`), loaded on demand. The runtime
   * AssetRegistry ignores this field; the AddressableManifest + WeChat subpackage
   * layout read it.
   */
  group: string;
  /** How `group` is delivered (folder convention). Absent ⇒ `local`. The
   *  AddressableManifest maps it to bundleMode; the WeChat subpackage layout and
   *  the CDN / hot-update path both read it. */
  groupMode?: GroupDelivery;
  /**
   * Present when this texture was packed into an atlas page: `path` then points
   * at the PAGE file (URL-level redirect for free) and this records where the
   * original image sits inside it. Frame pixels are in image space (y from the
   * page top); the runtime catalog derives uvOffset/uvScale from frame + page
   * size. Membership comes from {@link resolveAtlas} — a declared atlas or the
   * `<name>.atlas/` folder convention.
   */
  atlas?: {
    page: number;
    frame: { x: number; y: number; width: number; height: number };
    pageWidth: number;
    pageHeight: number;
  };
}

/**
 * Why an asset is in the build — the answer to "what is this doing in my package".
 *
 * `dependency` is the only one with a `via`: the asset that referenced it. Follow
 * those and the chain ends at whichever seed let it in, which is what a size
 * report shows beside a file nobody remembers adding.
 */
export type InclusionReason =
    /** An entry scene itself. */
    | 'entry'
    /** Referenced by another included asset (`via`). */
    | 'dependency'
    /** In a subpackage or remote group: delivered on demand, so nothing references it. */
    | 'group'
    /** In a group the project declared always-include. */
    | 'always-include'
    /** Addressed from code by a label on the asset. */
    | 'label'
    /** A locale table — loaded by code, so reachability would cull it. */
    | 'locale'
    /** A data asset (`.json`), named by the code that loads it. */
    | 'data'
    /** Named by a string literal in the project's scripts (`via` holds it). */
    | 'script';

/** How one asset got in: the reason, and for a dependency the asset that named it. */
export interface Inclusion {
  reason: InclusionReason;
  /** The referring asset's logical path, for `dependency`. */
  via?: string;
}

/** `assets.manifest.json` as the cook writes it — what the package carries. */
export interface CookManifest {
  version: string;
  entries: CookManifestEntry[];
}

/** The fields guaranteed when reading a flat cook manifest, including older exports. */
export type FlatCookEntry = Pick<CookManifestEntry, 'uuid' | 'path' | 'type'> & Partial<CookManifestEntry>;

/**
 * Load the project's asset-delivery config (`.esengine/asset-groups.json`) — the
 * single authored source for which folders ship as remote (CDN) / subpackage
 * groups. Absent or unparseable → null, and {@link resolveAssetGroup} falls back
 * to the legacy `remote/`/`subpackages/` folder-name convention.
 */
export async function loadAssetGroups(root: string): Promise<AssetGroupsConfig | null> {
  try {
    const raw = await readFile(path.join(root, '.esengine', 'asset-groups.json'), 'utf8');
    return JSON.parse(raw) as AssetGroupsConfig;
  } catch {
    return null;
  }
}

/**
 * The directory a non-local group's files live under — `subpackages/<name>` for a
 * lazy group, `remote/<name>` for a CDN one; null for the main package. A vendor
 * MOUNTS this root (a WeChat 分包 names it in game.json), so delivery fixes it
 * rather than the layout: a root the package lacks is refused with "root 不存在".
 */
export function groupRoot(name: string, delivery: GroupDelivery): string | null {
  if (delivery === 'lazy') return `subpackages/${name}`;
  if (delivery === 'remote') return `remote/${name}`;
  return null;
}

/** Content-addressed base dir for a group's delivery: main → `assets`,
 *  lazy → `subpackages/<name>/assets`, remote → `remote/<name>/assets`. */
function caBaseFor(name: string, delivery: GroupDelivery): string {
  const root = groupRoot(name, delivery);
  return root ? `${root}/assets` : 'assets';
}

/** `rel` moved under its group's root when names are kept. A path already there —
 *  the `subpackages/<name>/` folder convention — is its own root and stays put. */
function underGroupRoot(rel: string, name: string, delivery: GroupDelivery): string {
  const root = groupRoot(name, delivery);
  if (!root || rel === root || rel.startsWith(`${root}/`)) return rel;
  return `${root}/${rel}`;
}


/** What cooking one asset reports, held apart so concurrent cooks merge in order. */
interface CookSink {
  warnings: string[];
  failed: string[];
  defeatedByFormat: string[];
  manifestEntries: CookManifestEntry[];
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function pngSizeFromHeader(bytes: Uint8Array): ReturnType<typeof pngDimensions> | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)
      || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return null;
  return pngDimensions(bytes);
}

/** A PNG's width and height from its IHDR, reading only the header; null for anything else. */
async function pngHeaderSize(file: string): Promise<{ width: number; height: number } | null> {
  let handle;
  try {
    handle = await open(file, 'r');
    const header = new Uint8Array(24);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return pngSizeFromHeader(header.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/** `fn` over `items` with at most `limit` running, results in the items' order. */
async function mapInOrder<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

const KTX2_SCHEME_ZSTD = 2;

/** Replace a path's extension (e.g. .png → .ktx2); appends if it had none. */
function swapExt(p: string, ext: string): string {
  const cur = path.extname(p);
  return (cur ? p.slice(0, p.length - cur.length) : p) + ext;
}

/**
 * Rewrite a material's RELATIVE refs (shader / instanceOf / texture properties)
 * to the referenced asset's logical project path. Materials resolve relative
 * refs against their own directory at runtime — a structure content-addressed
 * staging destroys — so the staged copy carries directory-free logical refs and
 * the runtime's logical→staged maps take it from there. Logical paths outside
 * the runtime's passthrough prefixes ship as "/<logical>" (project-absolute).
 * `@uuid:`/URL refs and already-logical refs pass through unchanged.
 */
function rewriteMaterialRefs(
  bytes: Uint8Array,
  matPath: string,
  byPath: Map<string, AssetEntry>,
): Uint8Array {
  const json: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
  mapMaterialRefs(json, ref => logicalRef(ref, matPath, byPath));
  return new TextEncoder().encode(JSON.stringify(json, null, 2) + '\n');
}

/**
 * One document-relative ref as the logical project path a staged copy must carry:
 * staging is content-addressed, so the directory a relative ref resolves against
 * does not survive it. `@uuid:` / `builtin:` / URLs / already-logical refs and
 * anything naming no asset pass through.
 */
function logicalRef(ref: string, docPath: string, byPath: Map<string, AssetEntry>, first?: 'document' | 'project'): string;
function logicalRef(ref: unknown, docPath: string, byPath: Map<string, AssetEntry>, first?: 'document' | 'project'): unknown;
function logicalRef(ref: unknown, docPath: string, byPath: Map<string, AssetEntry>, first: 'document' | 'project' = 'document'): unknown {
  if (typeof ref !== 'string' || !ref || (ref.startsWith('/') && !/[?#]/.test(ref))) return ref;
  const target = findDocumentAsset(docPath, ref, file => byPath.get(file), first);
  if (!target) return ref;
  return target.path.startsWith('assets/') ? target.path : `/${target.path}`;
}

/**
 * A bitmap font names its page image as a sibling, in TEXT rather than JSON — the
 * same staging problem, and the same fix: the staged copy names the project path.
 */
function rewriteFontRefs(
  bytes: Uint8Array,
  fntPath: string,
  byPath: Map<string, AssetEntry>,
): Uint8Array {
  const text = Buffer.from(bytes).toString('utf8');
  return new TextEncoder().encode(text.replace(
    /(\bpage\b[^\n]*\bfile=")([^"]+)(")/g,
    (whole, head: string, ref: string, tail: string) => {
      const logical = logicalRef(ref, fntPath, byPath);
      return typeof logical === 'string' ? `${head}${logical}${tail}` : whole;
    },
  ));
}

function rewriteBitmapFontDocument(bytes: Uint8Array, docPath: string, byPath: Map<string, AssetEntry>): Uint8Array {
  const font = JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '')) as BitmapFontDocument | null;
  if (!font) return bytes;
  const field = bitmapFontMetricsField(font);
  const metrics = font[field];
  if (typeof metrics !== 'string' || !metrics) return bytes;
  font[field] = logicalRef(resolveDocumentRef(docPath, metrics), '', byPath);
  return new TextEncoder().encode(JSON.stringify(font, null, 2) + '\n');
}

/**
 * A groom names its curves file beside it (groom/groomFormat.ts), which staging moves out from under it: the
 * groom then loads and its strands 404. Each group's material is rewritten the same way.
 */
function rewriteGroomRefs(
  bytes: Uint8Array,
  docPath: string,
  byPath: Map<string, AssetEntry>,
): Uint8Array {
  const json = JSON.parse(Buffer.from(bytes).toString('utf8')) as { curves?: unknown; groups?: { material?: unknown }[]; cards?: { mesh?: unknown; material?: unknown } };
  if (typeof json.curves === 'string' && json.curves) json.curves = logicalRef(json.curves, docPath, byPath);
  // Its cards, the far level of detail: a mesh and a material beside it, moved by staging like the curves.
  if (json.cards && typeof json.cards.mesh === 'string') json.cards.mesh = logicalRef(json.cards.mesh, docPath, byPath);
  if (json.cards && typeof json.cards.material === 'string') json.cards.material = logicalRef(json.cards.material, docPath, byPath);
  for (const group of Array.isArray(json.groups) ? json.groups : []) {
    if (group && typeof group.material === 'string' && group.material) group.material = logicalRef(group.material, docPath, byPath);
  }
  return new TextEncoder().encode(JSON.stringify(json, null, 2) + '\n');
}

/**
 * An animator controller names the clips its motions play as sibling files, which
 * staging moves out from under it. The controller then loads and every state
 * plays nothing, which reads as a broken graph rather than a missing asset.
 */
function rewriteAnimatorRefs(
  bytes: Uint8Array,
  docPath: string,
  byPath: Map<string, AssetEntry>,
): Uint8Array {
  const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
  visitAnimatorClips(json, (kind, holder) => {
    if (typeof holder.clip !== 'string') return;
    const file = animatorMotionFile(kind, holder.clip, docPath, candidate => byPath.get(candidate)?.type);
    if (file?.path) holder.clip = file.path.startsWith('assets/') ? file.path : `/${file.path}`;
  });
  return new TextEncoder().encode(JSON.stringify(json, null, 2) + '\n');
}

/**
 * A baked environment names its images as SIBLING files, which staging moves out
 * from under it — the runtime then asks for `assets/sky_env.png` and gets a 404,
 * and the frame silently loses every reflection, or the sky, the game was made with.
 */
function rewriteEnvironmentRefs(
  bytes: Uint8Array,
  envPath: string,
  byPath: Map<string, AssetEntry>,
): Uint8Array {
  const json = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
  for (const field of ENV_IMAGE_FIELDS) {
    if (typeof json[field] === 'string') json[field] = logicalRef(json[field], envPath, byPath);
  }
  return new TextEncoder().encode(JSON.stringify(json, null, 2) + '\n');
}

/**
 * A map owns its inline tilesets and references to external sources. A .tsj owns its
 * grid or collection images. Use the same fields for staging and package validation.
 */
function mapTileDocumentRefs(
  json: Record<string, unknown>,
  docPath: string,
  map: (ref: string, kind: 'tile image' | 'tileset source', first: 'document' | 'project') => string,
): Record<string, unknown> {
  const image = (ref: string) => map(ref, 'tile image', 'document');
  if (docPath.toLowerCase().endsWith('.estileset')) {
    if (typeof json.texture === 'string' && json.texture) return { ...json, texture: map(json.texture, 'tile image', 'project') };
  } else if (docPath.toLowerCase().endsWith('.tsj')) {
    return mapTilesetImages(json, image);
  } else if (Array.isArray(json.tilesets)) {
    return { ...json, tilesets: json.tilesets.map(ts => typeof ts?.source === 'string'
      ? { ...ts, source: map(ts.source, 'tileset source', 'document') } : mapTilesetImages(ts, image)) };
  }
  return json;
}

const TILED_MAP = /\.(?:tmj|tmx)$/i;
const TILE_DOCUMENT = /\.(?:tmj|tmx|tsj|estileset)$/i;

function rewriteTilemapRefs(bytes: Uint8Array, docPath: string, byPath: Map<string, AssetEntry>): Uint8Array {
  const text = Buffer.from(bytes).toString('utf8');
  const json = TILED_MAP.test(docPath) ? parseTiledMapDocument(text) : JSON.parse(text) as Record<string, unknown>;
  const staged = mapTileDocumentRefs(json, docPath, (ref, _kind, first) => logicalRef(ref, docPath, byPath, first));
  return new TextEncoder().encode(JSON.stringify(staged, null, 2) + '\n');
}

/**
 * Asset paths a staged document names that the package does not carry. Three
 * defects of this shape were each a different type, and each was found by a game
 * drawing the wrong thing — a document's own references being the one place
 * nothing checked. Only KNOWN asset extensions count, so ordinary strings do not.
 */
function unresolvedDocumentRefs(
  docPath: string,
  text: string,
  shipped: ReadonlySet<string>,
): string[] {
  const missing = new Set<string>();
  for (const [, ref] of text.matchAll(/"([^"\n]{3,200})"/g)) {
    // By EXTENSION, not by looksLikeAssetPath: that one wants a directory in the
    // string, and a document naming a sibling — the exact shape of every defect
    // this is here for — has none.
    if (ref.includes('://') || !/\.[A-Za-z0-9]+$/.test(ref) || !getAssetTypeEntry(ref)) continue;
    // Resolved the way a loader will: refs travel in LOGICAL space, so a sibling
    // is a sibling of the document's project path, not of where staging put it.
    if (!shipped.has(resolveDocumentRef(docPath, ref).replace(/^\//, ''))) missing.add(ref);
  }
  return [...missing];
}

export interface CookResult {
  ok: boolean;
  /** Absolute output dir the assets + manifest were staged into. */
  outDir: string;
  /** Absolute manifest path, or null if not written. */
  manifestPath: string | null;
  /** uuids included (reachable from the entry scenes). */
  included: string[];
  /** The same assets as `included`, by project-relative source path — what a
   *  caller needs to read the content it just shipped (e.g. to scan the scenes
   *  for subsystems the target cannot render). */
  includedPaths: string[];
  /** The file, in the output, listing the models left as recipes for the game to bake where it loads; absent when there are none. */
  modelBakes?: string;
  /** The shipped audio clips whose import settings choose how they load (not `auto`), by logical path. */
  audioLoadTypes: Record<string, 'streaming' | 'decompress'>;
  /**
   * The shipped clips that were re-encoded, by logical path: how long each really is and the silence the encoding
   * put before it, in seconds. The runtime plays a clip from past that silence and loops it at its real end;
   * without this a loop that was seamless as a WAV has a gap every time round once it is packaged.
   */
  audioEncoded: Record<string, { seconds: number; lead: number }>;
  /** uuids present in the project but unreachable — culled from the build. */
  unused: string[];
  /**
   * Why each included asset is in the build, by its logical (project-relative)
   * path. The size report walks `via` back to a seed to say what pulled a file in.
   */
  inclusion: Record<string, Inclusion>;
  warnings: string[];
  /**
   * Assets the game REACHES that could not be produced, as `<path>: <why>`. Each
   * one is a hole in the package: the scene still references it and the runtime
   * fetches a path nothing staged. Kept apart from `warnings` because it is the
   * one cook outcome a caller must not ship.
   */
  failed: string[];
}

/**
 * The function that gives a `.esshader` its derived WGSL twin, or null when the converters are not here (anywhere but a checkout of the engine).
 * Loaded by a path it holds in a variable: the bundlers must leave the module and its wasm alone, and the cook runs from the same depth in
 * the package whether it is bundled or not, which is what lets one relative specifier name it.
 */
let twinDeriver: Promise<((source: string) => Promise<string>) | null> | undefined;
function shaderTwinDeriver(): Promise<((source: string) => Promise<string>) | null> {
  twinDeriver ??= (async () => {
    try {
      // A host that ships the converters (the packaged editor) says where they are;
      // a checkout of the engine finds them beside this file.
      const root = process.env.ESTELLA_SHADER_TWINS_ROOT;
      const specifier = root
        ? pathToFileURL(path.join(root, 'tools', 'lib', 'derivedTwin.mjs')).href
        : '../../../tools/lib/derivedTwin.mjs';
      return ((await import(/* @vite-ignore */ specifier)) as { withDerivedTwin: (source: string) => Promise<string> }).withDerivedTwin;
    } catch {
      return null;
    }
  })();
  return twinDeriver;
}

/**
 * Cook assets reachable from `entryScenes` (project-relative scene paths) into
 * `outDir` (project-relative or absolute). Returns what was included vs culled.
 */
/** The folder the project's startup script lives in — every export target cooks
 *  from here, so each one ships what the scripts name without being told. */
async function projectScriptDirs(root: string): Promise<string[]> {
  try {
    const main = resolveScripts(await readManifest(root)).main;
    return main ? [path.posix.dirname(main.split(path.sep).join('/').split('\\').join('/'))] : [];
  } catch {
    return [];
  }
}

export async function cookAssets(
  root: string,
  opts: {
    entryScenes: string[]; outDir: string;
    contentAddressed?: boolean; compressTextures?: boolean; atlasTextures?: boolean;
    /** Honor PNG Max Size without enabling GPU compression or loading Basis. */
    resizeTextures?: boolean;
    compressAudio?: boolean; transcodeVideo?: boolean;
    /** Target platform — selects each texture's per-platform Import Settings
     *  override (Default when absent). No effect on audio/video/atlas. */
    platform?: string;
    /**
     * What the package would pay to READ a KTX2 — the transcoder's bytes. A
     * project whose whole art weighs less than that cannot come out ahead by
     * compressing any of it, and is answered before anything is encoded.
     */
    textureDecoderBytes?: number;
    /** Stage a small copy of each texture a mesh draws as its surface (streamTail.ts), for texture streaming to fetch first.
     *  Worth it where files are fetched as they are needed (the web); a package downloaded whole only grows. */
    streamTails?: boolean;
    /** Project-relative folders holding the game's scripts: an asset a literal there
     *  names ships even when no scene references it (scriptAssetRefs.ts). Absent:
     *  the folder of the project's startup script; `[]` scans nothing. */
    scriptDirs?: string[];
    /** Leave out what a model source marked `bake: "load"` bakes (its mesh and maps), and list the source for the game to bake where it loads. */
    modelRecipes?: boolean;
  },
): Promise<CookResult> {
  const contentAddressed = opts.contentAddressed ?? false;
  const atlasTextures = opts.atlasTextures ?? false;
  const compressAudio = opts.compressAudio ?? false;
  const transcodeVideo = opts.transcodeVideo ?? false;
  const platform = opts.platform;
  // The bones one draw may carry on this platform (Project Settings, Rendering, Skinning): a skinned mesh built for more
  // is split again for it.
  const skinBudget = await readManifest(root).then((m) => maxBonesFor(m.features?.rendering?.skinning, platform)).catch(() => MESH_MAX_BONES);
  const streamTails = opts.streamTails ?? false;
  const { index } = await scanAssetDatabase(root, { write: false, adopt: false });
  const recipeProducts = new Map<string, { model: string; role: ModelProductRole }>();
  const recipeTexts = new Map<string, string>();
  for (const entry of index.entries) {
    if (!opts.modelRecipes || entry.type !== 'modeling' || entry.importer?.bake !== 'load') continue;
    try {
      const raw = JSON.parse(await readFile(path.join(root, entry.path), 'utf8')) as unknown;
      if (!bakesAtLoad(raw)) continue;
      recipeTexts.set(entry.path, JSON.stringify(raw));
      for (const [role, product] of Object.entries(modelProductPaths(entry.path))) recipeProducts.set(product, { model: entry.path, role: role as ModelProductRole });
    } catch {
      continue;
    }
  }
  const modelBakes = new Map<string, Partial<Record<ModelProductRole, string>>>();
  const warnings: string[] = [];
  const failed: string[] = [];
  // Second gate: nothing reaches it while the scanner drops these upstream, but
  // this is where bytes become an artifact someone else runs. Warns rather than
  // dropping silently — an asset missing from a build has to say why.
  const shippable = index.entries.filter((e) => {
    if (isInsideRoot(root, path.join(root, e.path))) return true;
    warnings.push(`${e.path}: resolves outside the project through a link — not shipped`);
    return false;
  });
  const byUuid = new Map(shippable.map((e) => [e.uuid, e]));
  const byPath = new Map(shippable.map((e) => [e.path, e]));
  // Asset-delivery config: which folders are remote (CDN) / subpackage groups.
  const groupsConfig = await loadAssetGroups(root);

  // Seed reachability from the entry scenes (path → uuid)…
  // Kept as it is discovered, not derived afterwards: the FIRST way in is the
  // shortest one, and re-deriving it later would answer a different question.
  const reachable = new Map<string, Inclusion>();
  let rejectedSceneIds: Set<string> | undefined;
  const seed = (uuid: string, how: Inclusion): void => {
    if (!rejectedSceneIds?.has(uuid) && !reachable.has(uuid)) {
      reachable.set(uuid, how);
    }
  };
  for (const scenePath of opts.entryScenes) {
    const entry = byPath.get(scenePath);
    if (!entry) {
      failed.push(`${scenePath}: required scene is missing from the asset index. Check the path and .meta file.`);
      continue;
    }
    if (entry.type !== 'scene') {
      failed.push(`${scenePath}: expected scene metadata, found "${entry.type}"`);
      // A rejected scene must also stay out of the package if another rule
      // would otherwise include it as data or a referenced asset.
      (rejectedSceneIds ??= new Set()).add(entry.uuid);
      continue;
    }
    seed(entry.uuid, { reason: 'entry' });
  }
  // Force-include lazy-subpackage assets: they're loaded on demand, so the entry
  // scene never references them — but they (and their deps) must still ship. A
  // shared dep that lives outside subpackages/ resolves to group 'main' below, so
  // it lands in the always-present main package, not duplicated per subpackage.
  for (const e of shippable) {
    const group = resolveAssetGroup(e.path, groupsConfig);
    // …and every non-local (subpackage / remote-CDN) asset: never scene-
    // referenced, but must be cooked + staged for its group's delivery.
    if (group.delivery !== 'local') seed(e.uuid, { reason: 'group' });
    // …and every asset in a group the project declared always-include: what a
    // scene cannot reference because only code names it (a path built at run
    // time, a texture in rich-text markup). Reachability would cull it, and the
    // first anyone would hear of that is a missing image on a device.
    else if (group.alwaysInclude) seed(e.uuid, { reason: 'always-include' });
    else if (e.labels?.length) seed(e.uuid, { reason: 'label' });
  }
  // Force-include locale string tables: translations load by code / plugin
  // option (a scene never references them — Text carries KEYS, not paths), so
  // reachability would always cull them, and a build missing its languages is
  // strictly wrong. Text is tiny; dead tables cost nothing.
  for (const e of shippable) {
    if (e.path.toLowerCase().endsWith('.eslocale')) seed(e.uuid, { reason: 'locale' });
  }
  // …and data assets, for the same reason one step further: a `.json` table is
  // named by the code that loads it, so nothing in the scene graph points at it.
  // Culling it produces the worst failure this pipeline can produce — it works in
  // the editor, which serves the whole project, and 404s only in the build.
  for (const e of shippable) {
    if (e.type === 'json') seed(e.uuid, { reason: 'data' });
  }
  // …and what the scripts name: a path only code holds never reaches a scene,
  // and culling it is a build that works in the editor and 404s on a device.
  const scriptDirs = opts.scriptDirs ?? await projectScriptDirs(root);
  if (scriptDirs.length > 0) {
    const scriptRefs = await scanScriptAssetRefs(root, scriptDirs);
    const named = matchScriptAssetRefs(scriptRefs, shippable);
    const registered = new Set(index.entries.map((e) => e.path));
    const onDisk = (rel: string): boolean => metaTypeFor(rel) !== null && isInsideRoot(root, path.join(root, rel))
      && existsSync(path.join(root, rel)) && !existsSync(path.join(root, rel) + META_EXT);
    for (const rel of unregisteredScriptRefs(scriptRefs, registered, onDisk)) {
      warnings.push(`${rel}: a script names it and it has no .meta, so the project does not know it and it is not shipped; `
        + 'open the project in the editor once, or run `estella adopt <projectDir>`');
    }
    const byFolder = new Map<string, number>();
    for (const { uuid, via } of named) {
      if (reachable.has(uuid)) continue;
      seed(uuid, { reason: 'script', via });
      if (via.endsWith('/')) byFolder.set(via, (byFolder.get(via) ?? 0) + 1);
    }
    for (const [folder, n] of byFolder) {
      warnings.push(`scripts build paths under "${folder}" at run time, so all ${n} asset(s) there ship; `
        + 'name the files whole, or list them as alwaysInclude, to ship only what is used');
    }
  }
  // …then take the transitive closure over the dependency graph.
  // Map keys iterate in insertion order and include discoveries appended during the walk.
  for (const uuid of reachable.keys()) {
    const from = byUuid.get(uuid)?.path;
    for (const dep of index.deps[uuid] ?? []) seed(dep, { reason: 'dependency', via: from });
  }

  // Terrain reads individual samples. Tilemap loaders use whole images as
  // fixed grids or read individual tile images before building their own atlas.
  const included = [...reachable.keys()];
  const terrainImages = new Set<string>();
  const wholeTileImages = new Set<string>();
  for (const uuid of included) {
    const asset = byUuid.get(uuid);
    if (!asset) continue;
    if (asset.type === 'terrain-tiles') {
      for (const dep of index.deps[uuid] ?? []) terrainImages.add(dep);
    } else if (TILE_DOCUMENT.test(asset.path)) {
      for (const dep of index.deps[uuid] ?? []) if (byUuid.get(dep)?.type === 'texture') wholeTileImages.add(dep);
    }
  }
  const preservesImage = (uuid: string) => terrainImages.has(uuid) || wholeTileImages.has(uuid);

  const absOut = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(root, opts.outDir);
  await mkdir(absOut, { recursive: true });

  // Stage each reachable asset's file + build the ship manifest. We read the
  // bytes (rather than copyFile) so we can content-hash exactly what ships — the
  // asset's physical identity. Once textures are encoded this naturally hashes the
  // ENCODED artifact (e.g. the .ktx2), since it hashes whatever bytes we stage.
  // Load the KTX2 encoder lazily (only when compressing — it pulls a ~MB wasm) and
  // by dynamic import, so the Electron-main bundle keeps it external rather than
  // inlining a module that resolves its wasm via import.meta.url.
  // Atlas pages compress as UASTC (they aggregate many textures — no single
  // per-asset setting applies); standalone textures use `textureEnc` directly so
  // each honors its own format / srgb / opt-out from the importer block.

  // Compressing cannot save more than the art weighs, and one KTX2 obliges the
  // package to carry the transcoder — so art lighter than it is answered before
  // the encoder loads. A project that authored a KTX2 pays either way.
  const textureSources = included
    .map((uuid) => byUuid.get(uuid))
    .filter((e): e is AssetEntry => e !== undefined && e.type === 'texture' && !recipeProducts.has(e.path));
  const authoredKtx2 = textureSources.some((e) => e.path.toLowerCase().endsWith('.ktx2'));
  const artBytes = textureSources.reduce((n, e) => {
    if (preservesImage(e.uuid)) return n;
    try { return n + statSync(path.join(root, e.path)).size; } catch { return n; }
  }, 0);
  const decoderBytes = opts.textureDecoderBytes;
  const decoderCanPay = decoderBytes === undefined || authoredKtx2 || artBytes > decoderBytes;
  const compressTextures = (opts.compressTextures ?? false) && decoderCanPay;
  if ((opts.compressTextures ?? false) && !decoderCanPay) {
    const kb = (n: number) => `${Math.round(n / 1024)}KB`;
    warnings.push(`textures ship raw: compressing every one of them could save at most `
      + `${kb(artBytes)}, and a package that holds a KTX2 carries a ${kb(decoderBytes!)} transcoder`);
  }

  let textureEnc: BasisEncoderModule | null = null;
  let encoderId = '';
  if (compressTextures) {
    ({ module: textureEnc, id: encoderId } = await loadTextureEncoder());
  }
  // WAV → MP3 (LAME wasm) rides the same lazy pattern; per-asset importer
  // settings can opt a clip out (seamless loops) or pick a bitrate.
  const encodedByUuid = new Map<string, { seconds: number; lead: number }>();
  let audioEnc: typeof import('./audioCook') | null = null;
  if (compressAudio) {
    audioEnc = await import('./audioCook');
  }
  // Video → MPEG-1 `.esv` + `.m4a` audio sibling, for targets whose only video
  // path is the wasm decoder (WeChat). ffmpeg loads lazily the same way.
  let videoEnc: typeof import('./videoCook') | null = null;
  if (transcodeVideo) {
    videoEnc = await import('./videoCook');
  }

  const manifestEntries: CookManifestEntry[] = [];
  const staged = new Set<string>();  // staged output paths, for content-addressed dedup
  // Images that asked to be compressed and are not PNG. Named together: this is
  // one fact about the project's source art, and one line per JPEG would bury
  // the per-asset findings that each need their own fix.
  const defeatedByFormat: string[] = [];
  // What Auto compression resolves by: whether a mesh anywhere in the project draws it.
  const roles = await meshTextureRoles(root, shippable);
  const pageCompressedBy = (frame: AssetEntry): boolean =>
    textureAsksCompression(readTextureCookSettings(frame.importer, platform).compress, roles.has(frame.uuid));

  // ---- Auto-atlas (`<name>.atlas/` folder convention) -----------------------
  // Pack the reachable PNGs of each atlas directory into pages BEFORE the
  // per-asset staging loop; each packed frame's manifest entry then points its
  // `path` at the page file (frame → page redirect happens at the URL level,
  // through the same buildPath machinery as every other rename). Pages are
  // plain textures to the rest of the cook: KTX2 compression and content-
  // addressed naming apply to them exactly as they would to a lone PNG.
  const atlasPlan = new Map<string, NonNullable<CookManifestEntry['atlas']> & {
    pageOutRel: string; pageHash: string; pageSize: number; compressedFormats?: string[];
  }>();
  if (atlasTextures) {
    const groups = new Map<string, AssetEntry[]>();
    for (const uuid of included) {
      const entry = byUuid.get(uuid);
      // Mesh UVs, material samplers and baked lightmaps address the whole texture.
      if (!entry || entry.type === 'scene' || roles.has(uuid) || preservesImage(uuid)) continue;
      if (path.extname(entry.path).toLowerCase() !== '.png') continue;
      const dir = resolveAtlas(entry.path, groupsConfig)?.name ?? null;
      if (!dir) continue;
      let list = groups.get(dir);
      if (!list) groups.set(dir, (list = []));
      list.push(entry);
    }
    for (const [dir, entries] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const compatible = new Map<string, AtlasInputImage[]>();
      for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
        try {
          const bytes = await readFile(path.join(root, entry.path));
          if (needsLosslessTextureCook(textureUse(entry.importer?.use), bytes)) continue;
          const image = decodePngImage(entry.path, bytes);
          const settings = textureImportSettingsFrom(entry.importer);
          image.wrap = settings?.wrap;
          if (fillsClearTexels(entry.importer, platform)) image.rgba = fillClearTexels(image) ?? image.rgba;
          const profile = atlasTextureSettingsKey(settings);
          let images = compatible.get(profile);
          if (!images) compatible.set(profile, images = []);
          images.push(image);
        } catch (err) {
          warnings.push(`${entry.path}: atlas decode failed, staging standalone — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const pages = [...compatible.values()].flatMap(images => packAtlas(images));
      for (let n = 0; n < pages.length; n++) {
        const page = pages[n];
        let pageBytes: Uint8Array;
        let pageExt = '.png';
        let compressedFormats: string[] | undefined;
        // One payload for every frame on the page, so it is compressed when a
        // frame on it asks to be; a page of sprites on Auto ships as a PNG.
        const pageFrames = page.placements.map(p => byPath.get(p.key)).filter((e): e is AssetEntry => !!e);
        const requester = textureEnc && pageFrames.find(pageCompressedBy);
        if (textureEnc && requester) {
          const { srgb, mipmaps } = readTextureCookSettings(requester.importer, platform);
          pageBytes = await textureEnc.encodeToKtx2({
            type: textureEnc.ImageType.RGBA, data: page.rgba, width: page.width, height: page.height,
          }, { mode: 'uastc', srgb, mipmaps });
          pageExt = '.ktx2';
          compressedFormats = COMPRESSED_TARGETS;
        } else {
          pageBytes = encodePagePng(page);
        }
        const pageHash = contentHashHex(pageBytes);
        const { name: group, delivery } = resolveAssetGroup(`${dir}/`, groupsConfig);
        const caBase = caBaseFor(group, delivery);
        const pageOutRel = contentAddressed
          ? `${caBase}/${pageHash}${pageExt}`
          : underGroupRoot(`${dir}.page${n}${pageExt}`, group, delivery);
        const dst = path.join(absOut, pageOutRel);
        if (!staged.has(pageOutRel)) {
          await mkdir(path.dirname(dst), { recursive: true });
          await writeFile(dst, pageBytes);
          staged.add(pageOutRel);
        }
        for (const placement of page.placements) {
          atlasPlan.set(placement.key, {
            page: n,
            frame: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
            pageWidth: page.width,
            pageHeight: page.height,
            pageOutRel, pageHash, pageSize: pageBytes.byteLength, compressedFormats,
          });
        }
      }
    }
  }

  const terrainPngSizes = new Map<string, ReturnType<typeof pngDimensions>>();
  // Each asset cooks on its own, and the encoder runs ENCODER_PARALLELISM images
  // at once, so that many are kept in flight. What each reports is merged back in
  // `reachable` order, which keeps the manifest and the warnings a serial cook's.
  const cookOne = async (uuid: string, { warnings, failed, defeatedByFormat,
                                         manifestEntries }: CookSink): Promise<void> => {
    const entry = byUuid.get(uuid);
    if (!entry) return;
    // Atlas-packed frame: the page is already staged; this entry just records
    // where the frame lives (page path + rect). Its physical identity IS the
    // page's (hash/size of the bytes actually served for this ref).
    const framePlan = atlasPlan.get(entry.path);
    if (framePlan) {
      const fg = resolveAssetGroup(entry.path, groupsConfig);
      // A frame's own Compress rows never reach an encoder: the page is what
      // ships. Saying so is the point — the row still reads as if it applied.
      const frameTex = readTextureCookSettings(entry.importer, platform);
      const frameCook = decideTextureCook({
        compressTextures, atlasTextures, inAtlas: true, raster: true,
        atlasPageCompressed: framePlan.compressedFormats !== undefined,
        compress: frameTex.compress, drawnIn3D: roles.has(entry.uuid), format: frameTex.format, size: null,
      });
      if (cookIntentDefeated(frameCook)) {
        warnings.push(`${entry.path}: ${explainTextureCook(frameCook)}`);
      }
      manifestEntries.push({
        uuid: entry.uuid,
        path: framePlan.pageOutRel,
        sourcePath: entry.path,
        type: entry.type,
        importer: entry.importer,
        ...(entry.labels?.length ? { labels: entry.labels } : {}),
        contentHash: framePlan.pageHash,
        size: framePlan.pageSize,
        group: fg.name,
        groupMode: fg.delivery,
        ...(framePlan.compressedFormats ? { compressedFormats: framePlan.compressedFormats } : {}),
        cook: frameCook,
        atlas: {
          page: framePlan.page,
          frame: framePlan.frame,
          pageWidth: framePlan.pageWidth,
          pageHeight: framePlan.pageHeight,
        },
      });
      return;
    }
    try {
      // Videos headed for transcode skip the eager read: ffmpeg streams the
      // file itself, so slurping a (potentially huge) source here would double
      // the I/O just to throw the bytes away.
      const willTranscodeVideo =
        videoEnc != null && entry.type === 'video' && path.extname(entry.path).toLowerCase() !== '.esv';
      const source = willTranscodeVideo ? Buffer.alloc(0) : await readFile(path.join(root, entry.path));
      // Validate the same bytes this cook will package, after reachability selects the scenes.
      if (entry.type === 'scene') {
        const scene = JSON.parse(source.toString('utf8')) as SceneData;
        requireSupportedSceneDocument(scene);
        requireUnambiguousSceneHierarchy(scene);
      }
      let data: Uint8Array = source;
      let ext = path.extname(entry.path);
      let tail: StreamTail | null = null;
      let compressedFormats: string[] | undefined;
      let cook: TextureCookDecision | undefined;
      const preserveSamples = preservesImage(entry.uuid);
      // An authored single-level UASTC KTX2 gets the chain a compressed texture
      // cannot generate on the device, under its own untouched level 0.
      const layout = textureEnc && !preserveSamples && entry.type === 'texture' && ext.toLowerCase() === '.ktx2' ? readKtx2Layout(data) : null;
      if (textureEnc && wantsMipChain(layout)) {
        const enc = textureEnc;
        const source = data;
        try {
          data = (await cookCached(root, [source, 'ktx2-mip-chain:1', encoderId], async () => {
            const decoded = await enc.transcodeKtx2ToRgba(source);
            const half = halveRgba(decoded.pixels, decoded.width, decoded.height, layout.srgb);
            const below = await enc.encodeToKtx2(
              { type: enc.ImageType.RGBA, data: half.rgba, width: half.width, height: half.height },
              {
                mode: 'uastc', srgb: layout.srgb, mipmaps: true, yFlip: false, uastcLevel: 0,
                supercompress: layout.scheme === KTX2_SCHEME_ZSTD,
              });
            return spliceMipChain(source, below);
          })).bytes;
        } catch (err) {
          warnings.push(`${entry.path}: ships its single level without mips — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Every image takes the decision, not only the ones an encoder accepts: a
      // JPEG whose Compress row reads ON leaves no other trace. Hash + name below
      // reflect the ENCODED bytes, so this composes with content-addressing.
      const fromRecipe = recipeProducts.get(entry.path);
      if (!fromRecipe && entry.type !== 'scene' && getAssetTypeEntry(entry.path)?.contentType === 'image') {
        const t = await cookTexture({
          root, path: entry.path, data, ext, importer: entry.importer, platform,
          encoder: textureEnc ? { module: textureEnc, id: encoderId } : null,
          compressTextures, atlasTextures, drawnIn3D: roles.has(entry.uuid),
          resizeTextures: opts.resizeTextures, preserveSamples,
        });
        data = t.data; ext = t.ext; cook = t.cook; compressedFormats = t.compressedFormats;
        warnings.push(...t.warnings);
        if (t.defeatedByFormat) defeatedByFormat.push(entry.path);
      }
      // Mesh previews use the shipped texture, whether imported as KTX2 or encoded by this cook.
      if (!fromRecipe && !preserveSamples && streamTails && roles.get(entry.uuid)?.has('surface')) {
        try {
          tail = await makeStreamTail(data, ext, readTextureCookSettings(entry.importer, platform).srgb);
        } catch (err) {
          warnings.push(`${entry.path}: no small copy for streaming — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // WAV sources re-encode to MP3 (universal decode); other audio formats are
      // already compressed and pass through. Hash + name reflect the ENCODED bytes.
      if (audioEnc && ext.toLowerCase() === '.wav') {
        const settings = audioEnc.audioImportSettings(entry.importer);
        if (settings.compress) {
          const mp3 = await audioEnc.encodeWavToMp3(data, settings.bitrateKbps);
          if (mp3 && mp3.byteLength < data.byteLength) {
            const trim = audioEnc.encodedClipTrim(data);
            if (trim) encodedByUuid.set(entry.uuid, trim);
            data = mp3;
            ext = '.mp3';
          } else if (!mp3) {
            warnings.push(`${entry.path}: WAV parse failed — shipped raw`);
          }
        }
      }
      // Video → `.esv` (MPEG-1 for the wasm decoder) + audio-track sibling.
      // `.esv` sources are already in the cooked format and pass through.
      let videoAudio: Uint8Array | null = null;
      if (willTranscodeVideo && videoEnc) {
        const settings = videoEnc.videoImportSettings(entry.importer);
        const res = await videoEnc.transcodeVideoForWasm(path.join(root, entry.path), settings);
        warnings.push(...res.warnings.map((w) => `${entry.path}: ${w}`));
        if (res.esv) {
          data = res.esv;
          ext = '.esv';
          videoAudio = res.audio;
        } else {
          throw new Error('video transcode failed — the original video cannot play on this target\'s WASM decoder');
        }
      }
      if (ext.toLowerCase() === '.esmesh' && skinBudget < MESH_MAX_BONES) {
        try {
          const fitted = fitSkinToBudget(data, skinBudget);
          if (fitted) data = fitted;
        } catch (err) {
          warnings.push(`${entry.path}: not split for ${skinBudget} bones a draw — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Materials: relative refs → logical project paths (see rewriteMaterialRefs).
      if (entry.type === 'material' || ext.toLowerCase() === '.esmaterial') {
        try {
          data = rewriteMaterialRefs(data, entry.path, byPath);
        } catch (err) {
          warnings.push(`${entry.path}: material ref rewrite failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Bitmap fonts: wrappers and metrics both name siblings.
      if (ext.toLowerCase() === '.fnt' || ext.toLowerCase() === '.bmfont') {
        try {
          data = ext.toLowerCase() === '.bmfont' ? rewriteBitmapFontDocument(data, entry.path, byPath) : rewriteFontRefs(data, entry.path, byPath);
        } catch (err) {
          warnings.push(`${entry.path}: font ref rewrite failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Environments: the sibling reflection atlas → its logical project path.
      if (ext.toLowerCase() === '.esenv') {
        try {
          data = rewriteEnvironmentRefs(data, entry.path, byPath);
        } catch (err) {
          warnings.push(`${entry.path}: environment ref rewrite failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Grooms: the curves file beside them, and each group's material → logical project paths.
      if (ext.toLowerCase() === '.esgroom') {
        try {
          data = rewriteGroomRefs(data, entry.path, byPath);
        } catch (err) {
          warnings.push(`${entry.path}: groom ref rewrite failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Animator controllers: the clips their motions play → logical project paths.
      if (ext.toLowerCase() === '.esanimator') {
        try {
          data = rewriteAnimatorRefs(data, entry.path, byPath);
        } catch (err) {
          warnings.push(`${entry.path}: animator ref rewrite failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Tilemaps: relative tileset image/source refs → logical project paths, so the
      // @uuid-loaded map resolves them to the embedded assets (see rewriteTilemapRefs).
      if (TILE_DOCUMENT.test(entry.path)) {
        try {
          data = rewriteTilemapRefs(data, entry.path, byPath);
        } catch (err) {
          warnings.push(`${entry.path}: tilemap ref rewrite failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // A WGSL twin is what makes a shader run on the WebGPU backend. The repo's own
      // sources carry none, so one is derived here from the GLSL when the converters
      // are at hand (a checkout of the engine); a project that ships its own twin has it
      // already, and one with neither is worth a cook-time warning.
      // Asked of every shader: a generated twin that no longer matches its GLSL is
      // derived afresh, and a hand-written one is left exactly as it is.
      if (ext.toLowerCase() === '.esshader') {
        const derive = await shaderTwinDeriver();
        if (derive) data = Buffer.from(await derive(Buffer.from(data).toString('utf8')), 'utf8');
      }
      if (ext.toLowerCase() === '.esshader' &&
          !Buffer.from(data).toString('utf8').includes('#pragma fragment wgsl')) {
        warnings.push(
          `${entry.path}: no WGSL twin, and it could not be derived from the GLSL here — this shader will not ` +
          'render on the WebGPU backend (export from the editor, which derives it, or add a `#pragma fragment wgsl` twin)',
        );
      }
      const hash = contentHashHex(data);
      // Content-addressed naming: leaf assets ship as assets/<hash><ext>, so
      // byte-identical assets collapse to one file (dedup) and the URL is immutable
      // — content changes yield a new name, so it is permanently cacheable. Scenes
      // keep their logical path: they're loaded by name and the exporters read +
      // transform them in place. Refs are by uuid, so renaming leaves is transparent.
      // Group by folder convention. Lazy-subpackage assets must stay under their
      // subpackage root (subpackages/<name>/…) so the root maps to a WeChat
      // subPackage — including the content-addressed layout (root/assets/<hash>).
      const { name: group, delivery } = resolveAssetGroup(entry.path, groupsConfig);
      // Scenes keep their logical path in every layout — they are loaded by name
      // and the exporters transform them in place, addressed by it — so a scene
      // cannot travel inside a group root, and says so instead.
      const useCA = contentAddressed && entry.type !== 'scene';
      const caBase = caBaseFor(group, delivery);
      const outRel = entry.type === 'scene'
        ? swapExt(entry.path, ext)
        : useCA
          ? `${caBase}/${hash}${ext}`
          : underGroupRoot(swapExt(entry.path, ext), group, delivery);
      if (entry.type === 'scene' && groupRoot(group, delivery)) {
        warnings.push(`${entry.path}: a scene ships in the main package — group '${group}' cannot carry it`);
      }
      const dst = path.join(absOut, outRel);
      if (fromRecipe) {
        modelBakes.set(fromRecipe.model, { ...modelBakes.get(fromRecipe.model), [fromRecipe.role]: outRel });
      } else if (!staged.has(outRel)) {
        staged.add(outRel);
        await mkdir(path.dirname(dst), { recursive: true });
        await writeFile(dst, data);
      }
      let streamTail: CookManifestEntry['streamTail'];
      if (tail) {
        const tailHash = contentHashHex(tail.bytes);
        const tailRel = useCA ? `${caBase}/${tailHash}${tail.ext}` : `${outRel}.tail${tail.ext}`;
        if (!staged.has(tailRel)) {
          staged.add(tailRel);
          await writeFile(path.join(absOut, tailRel), tail.bytes);
        }
        streamTail = {
          path: tailRel, size: tail.bytes.byteLength, contentHash: tailHash, width: tail.width,
          height: tail.height, fullWidth: tail.fullWidth, fullHeight: tail.fullHeight,
        };
      }
      if (terrainImages.has(entry.uuid) && !fromRecipe) {
        const size = pngSizeFromHeader(data);
        if (size) terrainPngSizes.set(entry.uuid.toLowerCase(), size);
      }
      manifestEntries.push({
        uuid: entry.uuid,
        path: outRel,
        sourcePath: entry.path,
        type: entry.type,
        importer: entry.importer,
        ...(entry.labels?.length ? { labels: entry.labels } : {}),
        contentHash: hash,
        size: fromRecipe ? 0 : data.byteLength,
        group,
        groupMode: delivery,
        ...(compressedFormats ? { compressedFormats } : {}),
        ...(cook ? { cook } : {}),
        ...(streamTail ? { streamTail } : {}),
      });
      // The video's audio track ships as its own manifest entry addressed as
      // `<source path>.m4a` / uuid `<video uuid>-audio` — the runtime resolves
      // it through the same ref channel as everything else. The flat layout
      // also keeps the `<staged>.m4a` sibling NAME (appended, not
      // extension-swapped, so it can't collide with a real `.m4a` asset) as a
      // resolver-free fallback; content addressing names it by ITS OWN bytes —
      // two videos with identical footage but different audio must not dedup
      // to one soundtrack.
      if (videoAudio) {
        const audioHash = contentHashHex(videoAudio);
        const audioOutRel = useCA ? `${caBase}/${audioHash}.m4a` : `${outRel}.m4a`;
        if (!staged.has(audioOutRel)) {
          staged.add(audioOutRel);
          await writeFile(path.join(absOut, audioOutRel), videoAudio);
        }
        manifestEntries.push({
          uuid: `${entry.uuid}-audio`,
          path: audioOutRel,
          sourcePath: `${entry.path}.m4a`,
          type: 'audio',
          contentHash: audioHash,
          size: videoAudio.byteLength,
          group,
          groupMode: delivery,
        });
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      warnings.push(`copy failed ${entry.path}: ${why}`);
      failed.push(`${entry.path}: ${why}`);
    }
  };
  const sinks = await mapInOrder(included, textureEnc?.ENCODER_PARALLELISM ?? 1, async (uuid) => {
    const sink: CookSink = { warnings: [], failed: [], defeatedByFormat: [], manifestEntries: [] };
    await cookOne(uuid, sink);
    return sink;
  });
  for (const sink of sinks) {
    warnings.push(...sink.warnings);
    failed.push(...sink.failed);
    defeatedByFormat.push(...sink.defeatedByFormat);
    manifestEntries.push(...sink.manifestEntries);
  }
  manifestEntries.sort((a, b) => a.path.localeCompare(b.path));

  // Is the package self-consistent? A document still naming a path the package
  // lacks is a 404 the game shows as a missing texture or absent lighting rather
  // than as an error — and the type it happens on need not be one anyone wired up.
  const shipped = new Set(manifestEntries.map((e) => e.sourcePath));
  let shippedKeys: ReturnType<typeof addressableKeys> | undefined;
  for (const entry of manifestEntries) {
    const type = getAssetTypeEntry(entry.sourcePath);
    if (type?.contentType !== 'json' && type?.contentType !== 'text' && !TILE_DOCUMENT.test(entry.sourcePath)) continue;
    let text: string;
    try {
      text = (await readFile(path.join(absOut, entry.path))).toString('utf8');
    } catch { continue; }
    if (entry.type === 'terrain-tiles') {
      const keys = shippedKeys ??= addressableKeys(manifestEntries);
      try {
        const doc = parseTerrainTiles(JSON.parse(text));
        const resolveImage = (ref: string) => {
          const logical = ref.replace(/^\//, '');
          return keys.get(logical) ?? keys.get(assetRefId(logical) ?? logical);
        };
        for (const ref of terrainTileImageRefs(doc)) {
          if (/^(?:https?:)?\/\//i.test(ref)) continue;
          // Terrain opens project paths and asset ids through the runtime catalog.
          if (resolveImage(ref)) continue;
          failed.push(`${entry.sourcePath}: terrain image '${ref}' is not packaged`);
        }
        for (const tile of doc.tiles) {
          const image = resolveImage(tile.height);
          const size = image && terrainPngSizes.get(image.key);
          if (!size) continue;
          const imagePath = byUuid.get(image.key)?.path ?? tile.height;
          const error = terrainTileSizeError(`${tile.x}:${tile.z}`, imagePath, doc.tileSamples, size);
          if (error) failed.push(`${entry.sourcePath}: ${error}`);
        }
      } catch (error) {
        failed.push(`${entry.sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    if (TILE_DOCUMENT.test(entry.sourcePath)) {
      const keys = shippedKeys ??= addressableKeys(manifestEntries);
      const missing = new Set<string>();
      try {
        const map = TILED_MAP.test(entry.sourcePath);
        const doc = map ? parseTiledMapDocument(text) : JSON.parse(text) as Record<string, unknown>;
        if (map) validateTiledTileData(doc);
        mapTileDocumentRefs(doc, entry.sourcePath, (ref, kind, first) => {
          if (!ref || /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i.test(ref)) return ref;
          const id = assetRefId(ref);
          const packaged = id ? keys.has(id) : findDocumentAsset(entry.sourcePath, ref, key => keys.get(key), first);
          if (!packaged) missing.add(`${entry.sourcePath}: ${kind} '${ref}' is not packaged`);
          return ref;
        });
      } catch (error) {
        missing.add(`${entry.sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      failed.push(...missing);
      continue;
    }
    for (const ref of unresolvedDocumentRefs(entry.sourcePath, text, shipped)) {
      warnings.push(`${entry.sourcePath}: names '${ref}', which the package does not carry`);
    }
  }

  if (modelBakes.size > 0) {
    const models = [...modelBakes].sort(([a], [b]) => a.localeCompare(b)).map(([source, products]) => ({ source, text: recipeTexts.get(source)!, products }));
    await writeFile(path.join(absOut, MODEL_BAKES_FILE), JSON.stringify({ version: 1, models } satisfies ModelBakesFile));
  }
  const manifestPath = path.join(absOut, MANIFEST);
  await writeFile(
    manifestPath,
    JSON.stringify({ version: '1.0', entries: manifestEntries }, null, 2) + '\n',
  );

  const unused = index.entries.filter((e) => !reachable.has(e.uuid)).map((e) => e.uuid);
  const includedPaths = included.map((uuid) => byUuid.get(uuid)?.path).filter((p): p is string => p !== undefined);
  // Said, not overridden: the author chose the file, and this is what it costs. A
  // lightmap is left out — the bake keeps it exact on purpose.
  const drawnRaw = compressTextures ? included.map((uuid) => byUuid.get(uuid)!)
    .filter((e) => e.type === 'texture' && roles.get(e.uuid)?.has('surface') && !atlasPlan.has(e.path)
      && readTextureCookSettings(e.importer, platform).compress === 'off') : [];
  if (drawnRaw.length) {
    let decoded = 0;
    for (const e of drawnRaw) {
      const size = await pngHeaderSize(path.join(root, e.path));
      if (size) decoded += size.width * size.height * 4 * 4 / 3;
    }
    warnings.push(`${drawnRaw.length} texture(s) a mesh draws ship as their original image (Compression: `
      + `Original image) — ${Math.round(decoded / 2 ** 20)} MiB of video memory decoded, where GPU `
      + `compressed would take about a quarter of it: ${drawnRaw.slice(0, 5).map((e) => e.path).join(', ')}`
      + `${drawnRaw.length > 5 ? ', …' : ''}`);
  }
  if (defeatedByFormat.length) {
    const shown = defeatedByFormat.slice(0, 3).join(', ');
    warnings.push(`${defeatedByFormat.length} image(s) ask to be compressed but are not PNG, so they `
      + `ship as they are — ${shown}${defeatedByFormat.length > 3 ? ', …' : ''}`);
  }
  // Keyed by logical path: that is what a reference names and what a report can
  // show, while the uuid is an identity nobody reading the report has.
  const inclusion: Record<string, Inclusion> = {};
  for (const [uuid, how] of reachable) {
    const logical = byUuid.get(uuid)?.path;
    if (logical) inclusion[logical] = how;
  }
  const audioLoadTypes: Record<string, 'streaming' | 'decompress'> = {};
  for (const uuid of included) {
    const e = byUuid.get(uuid);
    const type = e?.type === 'audio' ? audioLoadTypeOf(e.importer) : null;
    if (e && type) audioLoadTypes[e.path] = type;
  }
  const audioEncoded: Record<string, { seconds: number; lead: number }> = {};
  for (const [uuid, trim] of encodedByUuid) {
    const e = byUuid.get(uuid);
    // To a hundred-thousandth of a second, which is finer than a sample and keeps the config short.
    if (e && reachable.has(uuid)) audioEncoded[e.path] = { seconds: Math.round(trim.seconds * 1e5) / 1e5, lead: Math.round(trim.lead * 1e5) / 1e5 };
  }
  return {
    ok: failed.length === 0,
    outDir: absOut, manifestPath, included, includedPaths, audioLoadTypes, audioEncoded, unused, warnings, failed,
    ...(modelBakes.size > 0 ? { modelBakes: MODEL_BAKES_FILE } : {}),
    inclusion,
  };
}
