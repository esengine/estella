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
import { isInsideRoot } from './pathSandbox';
import path from 'node:path';
import { scanAssetDatabase, type AssetEntry } from './assetDb';
import { packAtlas, decodePngImage, encodePagePng, encodeRgbaPng, downscaleRgba, type AtlasInputImage } from './atlasPacker';
// Per-asset texture cook settings (compress opt-out / format / size cap), read
// from the `.meta` `importer` block — the same registry the inspector edits, so a
// texture's ship-time compression is authored per asset, not one global switch.
import { readTextureCookSettings } from '../src/project/assetImporter';
// Single-source content hash (sdk/src/asset/contentHash.ts). Imported as source —
// no hand-mirrored copy — so the cook and the runtime agree by construction.
import { contentHashHex } from '../../sdk/src/asset/contentHash';
import { resolveRelativePath } from '../../sdk/src/tilemap/tiledPath';
// Single source for the folder→delivery-group model, shared with the editor Play
// realm (sdk/src/asset/assetGroups.ts) so cook and editor never disagree.
import { resolveAssetGroup, resolveAtlas, type AssetGroupsConfig } from '../../sdk/src/asset/assetGroups';
import type { BundleMode } from '../../sdk/src/asset/AddressableManifest';

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

/** Content-addressed base dir for a group's delivery: main → `assets`,
 *  lazy → `subpackages/<name>/assets`, remote → `remote/<name>/assets`. */
function caBaseFor(name: string, delivery: GroupDelivery): string {
  if (delivery === 'lazy') return `subpackages/${name}/assets`;
  if (delivery === 'remote') return `remote/${name}/assets`;
  return 'assets';
}

/** Targets the KTX2 the cook emits can transcode to at runtime (UASTC + ETC1S). */
const COMPRESSED_TARGETS = ['astc-4x4', 'etc2-rgba8', 's3tc-dxt5'];

/** PNG width/height from the IHDR (big-endian u32 at byte offsets 16 / 20) —
 *  a header peek, so the `maxSize` cap can skip decoding textures already in range. */
function safePngDimensions(png: Uint8Array): { width: number; height: number } | null {
  try {
    return pngDimensions(png);
  } catch {
    return null;
  }
}

function pngDimensions(png: Uint8Array): { width: number; height: number } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** The slice of the vendored Basis encoder (build-tools/basis/encoder.mjs, a JS
 *  module) the cook uses. Typed locally so the per-texture format/srgb path stays
 *  type-checked without a hand-written `.d.ts`. */
interface BasisEncoderModule {
  encodePngToKtx2(png: Uint8Array, opts?: { mode?: string; srgb?: boolean }): Promise<Uint8Array>;
  encodeToKtx2(
    source: { type: string; data: Uint8Array; width?: number; height?: number },
    opts?: { mode?: string; srgb?: boolean },
  ): Promise<Uint8Array>;
  ImageType: { PNG: string; JPG: string; RGBA: string };
}

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
    // `builtin:<id>` shaders compile from in-code templates (no file); pass through like @uuid/URLs.
    if (typeof ref !== 'string' || ref.startsWith('@uuid:') || ref.startsWith('builtin:') || ref.includes('://')) return ref;
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
    if (Array.isArray(ts.tiles)) {
      // Image-collection tileset: one image per tile.
      for (const t of ts.tiles as Record<string, unknown>[]) {
        if (typeof t?.image === 'string') t.image = rewrite(t.image);
      }
    }
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
  /** The same assets as `included`, by project-relative source path — what a
   *  caller needs to read the content it just shipped (e.g. to scan the scenes
   *  for subsystems the target cannot render). */
  includedPaths: string[];
  /** uuids present in the project but unreachable — culled from the build. */
  unused: string[];
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
 * Cook assets reachable from `entryScenes` (project-relative scene paths) into
 * `outDir` (project-relative or absolute). Returns what was included vs culled.
 */
export async function cookAssets(
  root: string,
  opts: {
    entryScenes: string[]; outDir: string;
    contentAddressed?: boolean; compressTextures?: boolean; atlasTextures?: boolean;
    compressAudio?: boolean; transcodeVideo?: boolean;
    /** Target platform — selects each texture's per-platform Import Settings
     *  override (Default when absent). No effect on audio/video/atlas. */
    platform?: string;
  },
): Promise<CookResult> {
  const contentAddressed = opts.contentAddressed ?? false;
  const compressTextures = opts.compressTextures ?? false;
  const atlasTextures = opts.atlasTextures ?? false;
  const compressAudio = opts.compressAudio ?? false;
  const transcodeVideo = opts.transcodeVideo ?? false;
  const platform = opts.platform;
  const { index } = await scanAssetDatabase(root, { write: false, adopt: false });
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
  for (const e of shippable) {
    const group = resolveAssetGroup(e.path, groupsConfig);
    // …and every non-local (subpackage / remote-CDN) asset: never scene-
    // referenced, but must be cooked + staged for its group's delivery.
    if (group.delivery !== 'local') seed(e.uuid);
    // …and every asset in a group the project declared always-include: what a
    // scene cannot reference because only code names it (a path built at run
    // time, a texture in rich-text markup). Reachability would cull it, and the
    // first anyone would hear of that is a missing image on a device.
    else if (group.alwaysInclude) seed(e.uuid);
  }
  // Force-include locale string tables: translations load by code / plugin
  // option (a scene never references them — Text carries KEYS, not paths), so
  // reachability would always cull them, and a build missing its languages is
  // strictly wrong. Text is tiny; dead tables cost nothing.
  for (const e of shippable) {
    if (e.path.toLowerCase().endsWith('.eslocale')) seed(e.uuid);
  }
  // …and data assets, for the same reason one step further: a `.json` table is
  // named by the code that loads it, so nothing in the scene graph points at it.
  // Culling it produces the worst failure this pipeline can produce — it works in
  // the editor, which serves the whole project, and 404s only in the build.
  for (const e of shippable) {
    if (e.type === 'json') seed(e.uuid);
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
  // Atlas pages compress as UASTC (they aggregate many textures — no single
  // per-asset setting applies); standalone textures use `textureEnc` directly so
  // each honors its own format / srgb / opt-out from the importer block.
  let encodePng: ((png: Uint8Array) => Promise<Uint8Array>) | null = null;
  let textureEnc: BasisEncoderModule | null = null;
  if (compressTextures) {
    textureEnc = await import('../../build-tools/basis/encoder.mjs') as unknown as BasisEncoderModule;
    encodePng = (png) => textureEnc!.encodePngToKtx2(png, { mode: 'uastc' });
  }
  // WAV → MP3 (LAME wasm) rides the same lazy pattern; per-asset importer
  // settings can opt a clip out (seamless loops) or pick a bitrate.
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
      const dir = resolveAtlas(entry.path, groupsConfig)?.name ?? null;
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
        const { name: group, delivery } = resolveAssetGroup(`${dir}/`, groupsConfig);
        const caBase = caBaseFor(group, delivery);
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
      const fg = resolveAssetGroup(entry.path, groupsConfig);
      manifestEntries.push({
        uuid: entry.uuid,
        path: framePlan.pageOutRel,
        sourcePath: entry.path,
        type: entry.type,
        importer: entry.importer,
        contentHash: framePlan.pageHash,
        size: framePlan.pageSize,
        group: fg.name,
        groupMode: fg.delivery,
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
      // Videos headed for transcode skip the eager read: ffmpeg streams the
      // file itself, so slurping a (potentially huge) source here would double
      // the I/O just to throw the bytes away.
      const willTranscodeVideo =
        videoEnc != null && entry.type === 'video' && path.extname(entry.path).toLowerCase() !== '.esv';
      let data: Uint8Array = willTranscodeVideo
        ? new Uint8Array(0)
        : await readFile(path.join(root, entry.path));
      let ext = path.extname(entry.path);
      let compressedFormats: string[] | undefined;
      // Encode raster textures (PNG) to GPU-compressed KTX2 — they stay compressed
      // in VRAM, the runtime transcodes per device. Hash + name reflect the ENCODED
      // bytes, so this composes with content-addressing below.
      if (textureEnc && entry.type !== 'scene' && ext.toLowerCase() === '.png') {
        const tex = readTextureCookSettings(entry.importer, platform);
        // maxSize downscale first — it applies even when a texture opts OUT of
        // compression (a huge UI sprite can ship as a smaller raw PNG).
        let rgba: Uint8Array | null = null;
        let tw = 0, th = 0;
        try {
          const dims = pngDimensions(data);
          if (tex.maxSize < Math.max(dims.width, dims.height)) {
            const scaled = downscaleRgba(decodePngImage(entry.path, data), tex.maxSize);
            rgba = scaled.rgba; tw = scaled.width; th = scaled.height;
            if (!tex.compress) data = encodeRgbaPng(tw, th, rgba); // ship the shrunk PNG
          }
        } catch (err) {
          warnings.push(`${entry.path}: texture resize skipped — ${err instanceof Error ? err.message : String(err)}`);
        }
        // Per-asset compression: KTX2 (Basis) in the texture's chosen format, or
        // ship the raw/shrunk PNG when the asset opted out. Hash + name below
        // reflect the ENCODED bytes, so this composes with content-addressing.
        // WebGPU refuses a compressed texture whose size is not a multiple of its
        // 4x4 block, so a 70x70 sprite fails CreateTexture on the native runtime
        // and the game draws nothing. Ship those raw instead.
        const size = rgba ? { width: tw, height: th } : safePngDimensions(data);
        const blockAligned = size !== null && size.width % 4 === 0 && size.height % 4 === 0;
        if (tex.compress && !blockAligned) {
          warnings.push(`${entry.path}: shipped raw — ${size ? `${size.width}x${size.height}` : 'its size'} `
            + 'is not a multiple of 4, which a block-compressed texture must be');
        }
        if (tex.compress && blockAligned) {
          data = rgba
            ? await textureEnc.encodeToKtx2({ type: textureEnc.ImageType.RGBA, data: rgba, width: tw, height: th }, { mode: tex.format, srgb: tex.srgb })
            : await textureEnc.encodeToKtx2({ type: textureEnc.ImageType.PNG, data }, { mode: tex.format, srgb: tex.srgb });
          ext = '.ktx2';
          compressedFormats = COMPRESSED_TARGETS;
        }
      }
      // WAV sources re-encode to MP3 (universal decode); other audio formats are
      // already compressed and pass through. Hash + name reflect the ENCODED bytes.
      if (audioEnc && ext.toLowerCase() === '.wav') {
        const settings = audioEnc.audioImportSettings(entry.importer);
        if (settings.compress) {
          const mp3 = await audioEnc.encodeWavToMp3(data, settings.bitrateKbps);
          if (mp3 && mp3.byteLength < data.byteLength) {
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
          data = await readFile(path.join(root, entry.path));
          warnings.push(`${entry.path}: shipped untranscoded — this video will NOT play on the wasm decode path (WeChat)`);
        }
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
      const { name: group, delivery } = resolveAssetGroup(entry.path, groupsConfig);
      const useCA = contentAddressed && entry.type !== 'scene';
      const caBase = caBaseFor(group, delivery);
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
        groupMode: delivery,
        ...(compressedFormats ? { compressedFormats } : {}),
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
          await writeFile(path.join(absOut, audioOutRel), videoAudio);
          staged.add(audioOutRel);
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
  }
  manifestEntries.sort((a, b) => a.path.localeCompare(b.path));

  const manifestPath = path.join(absOut, MANIFEST);
  await writeFile(
    manifestPath,
    JSON.stringify({ version: '1.0', entries: manifestEntries }, null, 2) + '\n',
  );

  const unused = index.entries.filter((e) => !reachable.has(e.uuid)).map((e) => e.uuid);
  const includedPaths = [...reachable].map((uuid) => byUuid.get(uuid)?.path).filter((p): p is string => p !== undefined);
  return {
    ok: failed.length === 0,
    outDir: absOut, manifestPath, included: [...reachable], includedPaths, unused, warnings, failed,
  };
}
