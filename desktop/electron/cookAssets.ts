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
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { scanAssetDatabase, type AssetEntry } from './assetDb';
import { packAtlas, decodePngImage, encodePagePng, type AtlasInputImage } from './atlasPacker';
// Single-source content hash (sdk/src/asset/contentHash.ts). Imported as source —
// no hand-mirrored copy — so the cook and the runtime agree by construction.
import { contentHashHex } from '../../sdk/src/asset/contentHash';
import { resolveRelativePath } from '../../sdk/src/tilemap/tiledPath';

const MANIFEST = 'assets.manifest.json';

/**
 * One cooked asset in the ship manifest. Extends the DB index entry with the
 * physical-identity fields it needs: `contentHash` (XXH64 of the staged bytes)
 * and `size`. The runtime AssetRegistry consumes the same v1.0 manifest and
 * simply ignores these extra fields (it maps uuid→path); the AddressableManifest
 * and content-addressed naming are what read them.
 */
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
   * Addressable group this asset belongs to. `'main'` ships in the main package
   * (loaded eagerly); any other name is a lazy subpackage (folder convention:
   * `subpackages/<name>/…` → group `<name>`), loaded on demand. The runtime
   * AssetRegistry ignores this field; the AddressableManifest + WeChat subpackage
   * layout read it.
   */
  group: string;
  /**
   * Present when this texture was packed into an atlas page: `path` then points
   * at the PAGE file (URL-level redirect for free) and this records where the
   * original image sits inside it. Frame pixels are in image space (y from the
   * page top); the runtime catalog derives uvOffset/uvScale from frame + page
   * size. Produced by the `<name>.atlas/` folder convention.
   */
  atlas?: {
    page: number;
    frame: { x: number; y: number; width: number; height: number };
    pageWidth: number;
    pageHeight: number;
  };
}

/**
 * Folder-convention atlas detection: a PNG under a `<name>.atlas/` directory is
 * packed into that directory's atlas. Returns the directory path (the atlas's
 * identity — same-named dirs elsewhere are distinct atlases) or null.
 */
const ATLAS_DIR_RE = /^(.*?(?:^|\/)[^/]+\.atlas)\//;
export function atlasDirOf(projectRelPath: string): string | null {
  const m = ATLAS_DIR_RE.exec(projectRelPath.replace(/\\/g, '/'));
  return m ? m[1] : null;
}

/**
 * Folder-convention subpackage detection: an asset under `subpackages/<name>/…`
 * belongs to lazy group `<name>`. Returns null for main-package assets. The
 * single source of truth for the grouping — cook (here), export layout, and the
 * manifest all derive from it.
 */
const SUBPACKAGE_RE = /^subpackages\/([^/]+)\//;
export function subpackageOf(projectRelPath: string): string | null {
  const m = SUBPACKAGE_RE.exec(projectRelPath.replace(/\\/g, '/'));
  return m ? m[1] : null;
}

/** Targets the UASTC KTX2 the cook emits can transcode to at runtime. */
const COMPRESSED_TARGETS = ['astc-4x4', 'etc2-rgba8', 's3tc-dxt5'];

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
  const json = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
  const dir = matPath.includes('/') ? matPath.slice(0, matPath.lastIndexOf('/')) : '';
  const rewrite = (ref: unknown): unknown => {
    if (typeof ref !== 'string' || ref.startsWith('@uuid:') || ref.includes('://')) return ref;
    const norm = ref.replace(/^\.\//, '').replace(/^\//, '');
    if (byPath.has(norm)) return ref;  // already a logical project path
    const joined = dir ? `${dir}/${norm}` : norm;
    if (!byPath.has(joined)) return ref;  // not an asset ref (or missing) — leave it
    // Passthrough-safe spelling: bare when the runtime treats it as absolute,
    // "/"-rooted otherwise (both registered by the cooked host's maps).
    return joined.startsWith('assets/') ? joined : `/${joined}`;
  };
  if (typeof json.shader === 'string') json.shader = rewrite(json.shader);
  if (typeof json.instanceOf === 'string') json.instanceOf = rewrite(json.instanceOf);
  if (json.properties && typeof json.properties === 'object') {
    const props = json.properties as Record<string, unknown>;
    for (const key of Object.keys(props)) props[key] = rewrite(props[key]);
  }
  return new TextEncoder().encode(JSON.stringify(json, null, 2) + '\n');
}

/**
 * Rewrite a Tiled map's tileset `image` (inline) and `source` (external `.tsj`) refs
 * from document-relative (`"../textures/tileset.png"`) to the referenced asset's logical
 * project path — the same shape rewriteMaterialRefs produces. The playable loads a map by
 * its `@uuid` (which carries no directory), so the runtime's `resolveRelativePath(@uuid,
 * "../textures/x.png")` yields a WRONG root-relative path that matches no embedded asset;
 * a directory-free logical ref (`assets/textures/x.png`) resolves to the same inlined
 * asset in every realm. `@uuid:`/URL/already-logical refs pass through unchanged.
 */
function rewriteTilemapRefs(
  bytes: Uint8Array,
  tmjPath: string,
  byPath: Map<string, AssetEntry>,
): Uint8Array {
  const json = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
  const rewrite = (ref: unknown): unknown => {
    if (typeof ref !== 'string' || ref.startsWith('@uuid:') || ref.includes('://')) return ref;
    const proj = resolveRelativePath(tmjPath, ref);  // collapses ./ and ../
    if (!byPath.has(proj)) return ref;  // not an asset ref (or missing) — leave it
    return proj.startsWith('assets/') ? proj : `/${proj}`;
  };
  const tilesets = Array.isArray(json.tilesets) ? (json.tilesets as Record<string, unknown>[]) : [];
  for (const ts of tilesets) {
    if (typeof ts.image === 'string') ts.image = rewrite(ts.image);    // inline tileset image
    if (typeof ts.source === 'string') ts.source = rewrite(ts.source); // external .tsj tileset
  }
  return new TextEncoder().encode(JSON.stringify(json, null, 2) + '\n');
}

export interface CookResult {
  ok: boolean;
  /** Absolute output dir the assets + manifest were staged into. */
  outDir: string;
  /** Absolute manifest path, or null if not written. */
  manifestPath: string | null;
  /** uuids included (reachable from the entry scenes). */
  included: string[];
  /** uuids present in the project but unreachable — culled from the build. */
  unused: string[];
  warnings: string[];
}

/**
 * Cook assets reachable from `entryScenes` (project-relative scene paths) into
 * `outDir` (project-relative or absolute). Returns what was included vs culled.
 */
export async function cookAssets(
  root: string,
  opts: {
    entryScenes: string[]; outDir: string;
    contentAddressed?: boolean; compressTextures?: boolean; atlasTextures?: boolean;
  },
): Promise<CookResult> {
  const contentAddressed = opts.contentAddressed ?? false;
  const compressTextures = opts.compressTextures ?? false;
  const atlasTextures = opts.atlasTextures ?? false;
  const { index } = await scanAssetDatabase(root, { write: false });
  const byUuid = new Map(index.entries.map((e) => [e.uuid, e]));
  const byPath = new Map(index.entries.map((e) => [e.path, e]));
  const warnings: string[] = [];

  // Seed reachability from the entry scenes (path → uuid)…
  const reachable = new Set<string>();
  const queue: string[] = [];
  const seed = (uuid: string): void => {
    if (!reachable.has(uuid)) {
      reachable.add(uuid);
      queue.push(uuid);
    }
  };
  for (const scenePath of opts.entryScenes) {
    const entry = byPath.get(scenePath);
    if (!entry) {
      warnings.push(`entry scene not in asset index: ${scenePath}`);
      continue;
    }
    seed(entry.uuid);
  }
  // Force-include lazy-subpackage assets: they're loaded on demand, so the entry
  // scene never references them — but they (and their deps) must still ship. A
  // shared dep that lives outside subpackages/ resolves to group 'main' below, so
  // it lands in the always-present main package, not duplicated per subpackage.
  for (const e of index.entries) {
    if (subpackageOf(e.path)) seed(e.uuid);
  }
  // …then take the transitive closure over the dependency graph.
  while (queue.length > 0) {
    const uuid = queue.shift()!;
    for (const dep of index.deps[uuid] ?? []) seed(dep);
  }

  const absOut = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(root, opts.outDir);
  await mkdir(absOut, { recursive: true });

  // Stage each reachable asset's file + build the ship manifest. We read the
  // bytes (rather than copyFile) so we can content-hash exactly what ships — the
  // asset's physical identity. Once textures are encoded this naturally hashes the
  // ENCODED artifact (e.g. the .ktx2), since it hashes whatever bytes we stage.
  // Load the KTX2 encoder lazily (only when compressing — it pulls a ~MB wasm) and
  // by dynamic import, so the Electron-main bundle keeps it external rather than
  // inlining a module that resolves its wasm via import.meta.url.
  let encodePng: ((png: Uint8Array) => Promise<Uint8Array>) | null = null;
  if (compressTextures) {
    const enc = await import('../../build-tools/basis/encoder.mjs');
    encodePng = (png) => enc.encodePngToKtx2(png, { mode: 'uastc' });
  }

  const manifestEntries: CookManifestEntry[] = [];
  const staged = new Set<string>();  // staged output paths, for content-addressed dedup

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
    for (const uuid of reachable) {
      const entry = byUuid.get(uuid);
      if (!entry || entry.type === 'scene') continue;
      if (path.extname(entry.path).toLowerCase() !== '.png') continue;
      const dir = atlasDirOf(entry.path);
      if (!dir) continue;
      let list = groups.get(dir);
      if (!list) groups.set(dir, (list = []));
      list.push(entry);
    }
    for (const [dir, entries] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const images: AtlasInputImage[] = [];
      for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
        try {
          images.push(decodePngImage(entry.path, await readFile(path.join(root, entry.path))));
        } catch (err) {
          warnings.push(`${entry.path}: atlas decode failed, staging standalone — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (images.length === 0) continue;
      const pages = packAtlas(images);
      for (let n = 0; n < pages.length; n++) {
        let pageBytes: Uint8Array = encodePagePng(pages[n]);
        let pageExt = '.png';
        let compressedFormats: string[] | undefined;
        if (encodePng) {
          pageBytes = await encodePng(pageBytes);
          pageExt = '.ktx2';
          compressedFormats = COMPRESSED_TARGETS;
        }
        const pageHash = contentHashHex(pageBytes);
        const group = subpackageOf(`${dir}/`) ?? 'main';
        const caBase = group === 'main' ? 'assets' : `subpackages/${group}/assets`;
        const pageOutRel = contentAddressed
          ? `${caBase}/${pageHash}${pageExt}`
          : `${dir}.page${n}${pageExt}`;
        const dst = path.join(absOut, pageOutRel);
        if (!staged.has(pageOutRel)) {
          await mkdir(path.dirname(dst), { recursive: true });
          await writeFile(dst, pageBytes);
          staged.add(pageOutRel);
        }
        for (const placement of pages[n].placements) {
          atlasPlan.set(placement.key, {
            page: n,
            frame: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
            pageWidth: pages[n].width,
            pageHeight: pages[n].height,
            pageOutRel, pageHash, pageSize: pageBytes.byteLength, compressedFormats,
          });
        }
      }
    }
  }

  for (const uuid of reachable) {
    const entry = byUuid.get(uuid);
    if (!entry) continue;
    // Atlas-packed frame: the page is already staged; this entry just records
    // where the frame lives (page path + rect). Its physical identity IS the
    // page's (hash/size of the bytes actually served for this ref).
    const framePlan = atlasPlan.get(entry.path);
    if (framePlan) {
      manifestEntries.push({
        uuid: entry.uuid,
        path: framePlan.pageOutRel,
        sourcePath: entry.path,
        type: entry.type,
        importer: entry.importer,
        contentHash: framePlan.pageHash,
        size: framePlan.pageSize,
        group: subpackageOf(entry.path) ?? 'main',
        ...(framePlan.compressedFormats ? { compressedFormats: framePlan.compressedFormats } : {}),
        atlas: {
          page: framePlan.page,
          frame: framePlan.frame,
          pageWidth: framePlan.pageWidth,
          pageHeight: framePlan.pageHeight,
        },
      });
      continue;
    }
    try {
      let data: Uint8Array = await readFile(path.join(root, entry.path));
      let ext = path.extname(entry.path);
      let compressedFormats: string[] | undefined;
      // Encode raster textures (PNG) to GPU-compressed KTX2 — they stay compressed
      // in VRAM, the runtime transcodes per device. Hash + name reflect the ENCODED
      // bytes, so this composes with content-addressing below.
      if (encodePng && entry.type !== 'scene' && ext.toLowerCase() === '.png') {
        data = await encodePng(data);
        ext = '.ktx2';
        compressedFormats = COMPRESSED_TARGETS;
      }
      // Materials: relative refs → logical project paths (see rewriteMaterialRefs).
      if (ext.toLowerCase() === '.esmaterial') {
        try {
          data = rewriteMaterialRefs(data, entry.path, byPath);
        } catch (err) {
          warnings.push(`${entry.path}: material ref rewrite failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Tilemaps: relative tileset image/source refs → logical project paths, so the
      // @uuid-loaded map resolves them to the embedded assets (see rewriteTilemapRefs).
      if (ext.toLowerCase() === '.tmj' || ext.toLowerCase() === '.tmx') {
        try {
          data = rewriteTilemapRefs(data, entry.path, byPath);
        } catch (err) {
          warnings.push(`${entry.path}: tilemap ref rewrite failed — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Shaders ship as-authored; a WGSL twin is what makes one run on the
      // WebGPU backend, so a twin-less shader is worth a cook-time warning
      // (generation is a dev-time step — tools/gen-shader-twins.mjs writes the
      // twins into the source file, keeping the cook deterministic and free of
      // converter-toolchain dependencies).
      if (ext.toLowerCase() === '.esshader' &&
          !Buffer.from(data).toString('utf8').includes('#pragma fragment wgsl')) {
        warnings.push(
          `${entry.path}: no WGSL twin — this shader will not render on the WebGPU backend ` +
          '(run tools/gen-shader-twins.mjs to generate one)',
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
      const group = subpackageOf(entry.path) ?? 'main';
      const useCA = contentAddressed && entry.type !== 'scene';
      const caBase = group === 'main' ? 'assets' : `subpackages/${group}/assets`;
      const outRel = useCA ? `${caBase}/${hash}${ext}` : swapExt(entry.path, ext);
      const dst = path.join(absOut, outRel);
      if (!staged.has(outRel)) {
        await mkdir(path.dirname(dst), { recursive: true });
        await writeFile(dst, data);
        staged.add(outRel);
      }
      manifestEntries.push({
        uuid: entry.uuid,
        path: outRel,
        sourcePath: entry.path,
        type: entry.type,
        importer: entry.importer,
        contentHash: hash,
        size: data.byteLength,
        group,
        ...(compressedFormats ? { compressedFormats } : {}),
      });
    } catch (err) {
      warnings.push(`copy failed ${entry.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  manifestEntries.sort((a, b) => a.path.localeCompare(b.path));

  const manifestPath = path.join(absOut, MANIFEST);
  await writeFile(
    manifestPath,
    JSON.stringify({ version: '1.0', entries: manifestEntries }, null, 2) + '\n',
  );

  const unused = index.entries.filter((e) => !reachable.has(e.uuid)).map((e) => e.uuid);
  return { ok: true, outDir: absOut, manifestPath, included: [...reachable], unused, warnings };
}
