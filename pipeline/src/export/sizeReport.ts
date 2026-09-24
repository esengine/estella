// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the finished build actually weighs.
 *
 *        Measures the OUTPUT DIRECTORY rather than adding up what the cook
 *        thought it wrote. Every target then gets a real number for free — the
 *        engine runtime, the bundled scripts, the host page and the assets are
 *        all just files on disk by the time this runs, so web, desktop, WeChat, a
 *        project's own mini-game vendor and a native content payload are one code
 *        path and cannot drift into per-target accounting.
 *
 *        Where the bytes SIT is the part that matters, and the build already
 *        knows: the AddressableManifest's `bundleMode` per group is the single
 *        authored truth for delivery (`local` = in the main package, `lazy` = a
 *        subpackage fetched on demand, `remote` = a CDN download that is not in
 *        the package at all). This reads that same manifest, so the report agrees
 *        with what the runtime will do by construction, and 30MB of hot-updatable
 *        art is correctly reported as costing the package nothing. Anything on
 *        disk the manifest does not claim — wasm, glue, bundles, index.html — is
 *        part of what a player downloads before playing, so it counts as initial.
 *
 *        Pure Node (fs). The arithmetic is separated from the walking so the
 *        tests can check the accounting without a build on disk.
 */
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ExportPlatform } from '../project/platforms';
import {
  evaluateSizeBudget, resolveSizeBudgets,
  type SizeBudget, type SizeVerdict,
} from '../project/sizeBudget';
import type { Inclusion, InclusionReason } from '../assets/cookAssets';
import {
  compareSizes, readSizeRecord, recordOf, writeSizeRecord,
  type SizeComparison, type SizeSettings,
} from './sizeHistory';

/** Where a file sits in the delivery model — see the file header. */
export type SizeBucket = 'initial' | 'lazy' | 'remote';

/**
 * What a file IS, for the "who is eating my package" breakdown.
 *
 * Coarse on purpose: the answer a developer acts on is "textures are 60% of
 * this", and a finer taxonomy (which texture format, which script) is the
 * `largest` list's job.
 */
export type SizeKind = 'engine' | 'scripts' | 'texture' | 'audio' | 'video' | 'font' | 'scene' | 'data' | 'other';

/** Why a file is in the build: what let it in, and what it came in through. */
export interface SizeAttribution {
  reason: InclusionReason;
  /**
   * From the file's own logical path back to the seed that let it in — the
   * answer to "why is this in my package". One entry when it IS the seed.
   */
  chain: string[];
}

/** One file in the finished build. */
export interface BuildSizeEntry {
  /** Path relative to the measured root, in POSIX form (the shipped shape). */
  path: string;
  bytes: number;
  bucket: SizeBucket;
  kind: SizeKind;
  /** Absent for a file the cook did not stage (the engine runtime, the host page). */
  why?: SizeAttribution;
  /** What it weighed before the export packed it. Only set for a file the export
   *  compressed itself — `bytes` is always what ships. */
  sourceBytes?: number;
}

export interface KindTotal {
  kind: SizeKind;
  bytes: number;
  count: number;
}

/** The measurement, as the export result carries it and the build dialog draws it. */
export interface BuildSizeReport {
  /** Bytes a player downloads before the game is playable. */
  initialBytes: number;
  /** Bytes in subpackages, fetched when the game asks for that group. */
  lazyBytes: number;
  /** Bytes staged for a CDN — hot-updatable content, not in the package. */
  remoteBytes: number;
  /** `initial` + `lazy`: what the package weighs. Excludes `remote`. */
  packageBytes: number;
  /** Total on disk, including the CDN staging area. */
  totalBytes: number;
  fileCount: number;
  /** The single uploaded file, when the target has one (an ad network's
   *  index.html/zip, an .apk). Absent for targets that ship a directory. */
  deliverableBytes?: number;
  /** That file's name, so the UI can say what was weighed. */
  deliverableName?: string;
  /** The heaviest subpackage (`subpackages/<name>`), when the build has any. */
  largestSubpackage?: { root: string; bytes: number };
  /** Largest first, capped at {@link LARGEST_FILES}. */
  largest: BuildSizeEntry[];
  /** Package composition (initial + lazy), largest kind first. Excludes remote:
   *  the question this answers is what fills the PACKAGE. */
  byKind: KindTotal[];
  /** Every limit in force, judged. Empty when the target declares none and the
   *  project set no budget. */
  verdicts: SizeVerdict[];
  /** This build against the last one of the same platform; absent for the first. */
  since?: SizeComparison;
  /** What the export's own compression bought, when it compressed anything. A
   *  limit is judged on packed bytes, so `bytes` everywhere else is the packed
   *  number and this is the only place the other one appears. */
  packing?: { fromBytes: number; toBytes: number; fileCount: number };
}

/** How many files the report names individually. Enough to find the offender,
 *  short enough to read at a glance. */
export const LARGEST_FILES = 12;

/** Build artifacts that are not shipped content and must not be counted: the
 *  intermediate flat manifest is deleted by the export, and sourcemaps are a
 *  development aid the host never downloads. */
const NOT_SHIPPED = new Set(['assets.manifest.json']);
const isSourceMap = (rel: string): boolean => rel.endsWith('.map');

const EXT_KIND: Readonly<Record<string, SizeKind>> = {
  '.wasm': 'engine',
  '.png': 'texture', '.jpg': 'texture', '.jpeg': 'texture', '.webp': 'texture',
  '.ktx2': 'texture', '.basis': 'texture', '.astc': 'texture', '.pvr': 'texture',
  '.mp3': 'audio', '.ogg': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio',
  '.mp4': 'video', '.esv': 'video', '.webm': 'video',
  '.ttf': 'font', '.otf': 'font', '.woff': 'font', '.woff2': 'font', '.fnt': 'font',
  '.js': 'scripts', '.mjs': 'scripts', '.cjs': 'scripts',
  '.json': 'data', '.txt': 'data', '.atlas': 'data', '.skel': 'data', '.tmj': 'data',
  '.esshader': 'data', '.eslocale': 'data', '.bin': 'data',
  '.html': 'other', '.css': 'other',
};

/**
 * What kind of thing a shipped file is.
 *
 * The wasm directory is engine whatever it holds: its JS is emscripten glue, not
 * game code, and reporting it as "scripts" would make every project look like it
 * shipped a megabyte of gameplay logic. Scenes are called out from the rest of
 * the JSON because "my scenes are huge" is a different fix than "my data is".
 */
export function kindOf(rel: string): SizeKind {
  const p = rel.toLowerCase();
  if (p === 'wasm' || p.startsWith('wasm/') || p.includes('/wasm/')) return 'engine';
  if (p.startsWith('scenes/') || p.endsWith('.esscene')) return 'scene';
  let ext = path.extname(p);
  // A mini-game packer that refuses an extension takes the file restaged as
  // `<name>.<ext>.bin` (miniGameExportProfile `binRestageExts`) — so a WeChat
  // package's textures arrive here as `.ktx2.bin`. They are still textures, and
  // a composition chart that filed them under "data" would send a developer
  // hunting through their JSON for megabytes that are in their art.
  if (ext === '.bin') {
    const inner = path.extname(p.slice(0, -'.bin'.length));
    if (inner) ext = inner;
  }
  // Same shape one layer out: a host whose loader takes `.wasm.br` is shipped the
  // compressed binary, and it is still whatever it was before compression.
  if (ext === '.br') {
    const inner = path.extname(p.slice(0, -'.br'.length));
    if (inner) ext = inner;
  }
  return EXT_KIND[ext] ?? 'other';
}

/**
 * Delivery bucket per shipped path, read off the AddressableManifest the build
 * just wrote. Paths in the manifest are relative to the same root this measures,
 * so the lookup is direct.
 *
 * A build with no manifest (the playable's single inlined file, a legacy cook)
 * yields an empty index — every file then counts as initial, which is exactly
 * right for a target that has no subpackages.
 */
export function bucketIndexFrom(manifest: unknown): Map<string, SizeBucket> {
  const index = new Map<string, SizeBucket>();
  const groups = (manifest as { groups?: Record<string, { bundleMode?: string; assets?: Record<string, { path?: string }> }> } | null)?.groups;
  if (!groups) return index;
  for (const group of Object.values(groups)) {
    const bucket: SizeBucket = group?.bundleMode === 'lazy' ? 'lazy' : group?.bundleMode === 'remote' ? 'remote' : 'initial';
    for (const asset of Object.values(group?.assets ?? {})) {
      if (asset?.path) index.set(normalizeRel(asset.path), bucket);
    }
  }
  return index;
}

const normalizeRel = (p: string): string => p.replace(/\\/g, '/').replace(/^\.?\//, '');

/**
 * Shipped path → the asset's LOGICAL path, off the same manifest the buckets come
 * from. Content-addressed staging renames the file, so without this the shipped
 * name matches nothing a reference (or a developer) knows it by.
 */
export function logicalIndexFrom(manifest: unknown): Map<string, string> {
  const index = new Map<string, string>();
  const groups = (manifest as { groups?: Record<string, { assets?: Record<string, { path?: string; address?: string }> }> } | null)?.groups;
  for (const group of Object.values(groups ?? {})) {
    for (const [key, asset] of Object.entries(group?.assets ?? {})) {
      if (!asset?.path) continue;
      const shipped = normalizeRel(asset.path);
      // `address` is the logical path when staging renamed the file; otherwise the
      // key IS a logical path (the manifest lists each asset under several aliases,
      // and a uuid alias is no use to a reader).
      const logical = asset.address ?? (key.startsWith('@uuid:') ? undefined : key);
      if (logical && !index.has(shipped)) index.set(shipped, normalizeRel(logical));
    }
  }
  return index;
}

/**
 * The chain from a logical path back to the seed that let it in. Stops at the
 * first repeat: a reference cycle is a graph a project can have, and a report
 * that hangs on one is worse than a chain that ends early.
 */
export function inclusionChain(logical: string, inclusion: Record<string, Inclusion>): SizeAttribution | undefined {
  const first = inclusion[logical];
  if (!first) return undefined;
  const chain = [logical];
  const seen = new Set([logical]);
  let step = first;
  while (step.reason === 'dependency' && step.via && !seen.has(step.via)) {
    chain.push(step.via);
    seen.add(step.via);
    const next = inclusion[step.via];
    if (!next) break;
    step = next;
  }
  // The REASON is the seed's, not this asset's: "a dependency" says nothing on
  // its own, and what a reader wants is the scene (or the rule) at the end.
  return { reason: step.reason, chain };
}

/** Whether @p rel is one of @p roots or sits inside one of them. */
const isUnder = (rel: string, roots: readonly string[]): boolean =>
    roots.some((root) => rel === root || rel.startsWith(`${root}/`));

/** What the report counts, per shipped file. Pure — the tests drive it. */
export function entriesOf(
  files: readonly { path: string; bytes: number }[],
  opts: {
    buckets?: Map<string, SizeBucket>;
    logical?: Map<string, string>;
    inclusion?: Record<string, Inclusion>;
    /** Project-relative staged path → what it weighed before being packed. */
    packedFrom?: Readonly<Record<string, number>>;
  } = {},
): BuildSizeEntry[] {
  const buckets = opts.buckets ?? new Map<string, SizeBucket>();
  const entries: BuildSizeEntry[] = [];
  for (const file of files) {
    const rel = normalizeRel(file.path);
    if (NOT_SHIPPED.has(rel) || isSourceMap(rel)) continue;
    const bucket = buckets.get(rel) ?? 'initial';
    const logical = opts.logical?.get(rel);
    const why = logical && opts.inclusion ? inclusionChain(logical, opts.inclusion) : undefined;
    const from = opts.packedFrom?.[rel];
    entries.push({
      path: rel, bytes: file.bytes, bucket, kind: kindOf(rel),
      ...(why ? { why } : {}), ...(from !== undefined ? { sourceBytes: from } : {}),
    });
  }
  return entries;
}

/**
 * Turn measured files into the report. Pure — the tests drive it with a list of
 * paths and sizes, no build required.
 */
export function summarizeBuildFiles(
  files: readonly { path: string; bytes: number }[],
  opts: {
    buckets?: Map<string, SizeBucket>;
    budgets?: readonly SizeBudget[];
    deliverableBytes?: number;
    deliverableName?: string;
    /** Shipped path → logical path ({@link logicalIndexFrom}). */
    logical?: Map<string, string>;
    /** Why each asset is in the build, by logical path (the cook's answer). */
    inclusion?: Record<string, Inclusion>;
  } = {},
): BuildSizeReport {
  return summarizeEntries(entriesOf(files, opts), opts);
}

/** The report over entries already counted — what {@link measureBuild} keeps, so the
 *  history record and the report are the same measurement. */
export function summarizeEntries(
  entries: readonly BuildSizeEntry[],
  opts: {
    budgets?: readonly SizeBudget[];
    deliverableBytes?: number;
    deliverableName?: string;
  } = {},
): BuildSizeReport {
  let initialBytes = 0, lazyBytes = 0, remoteBytes = 0, totalBytes = 0;
  const kinds = new Map<SizeKind, KindTotal>();

  for (const file of entries) {
    const { bucket, kind } = file;
    totalBytes += file.bytes;
    if (bucket === 'remote') remoteBytes += file.bytes;
    else {
      if (bucket === 'lazy') lazyBytes += file.bytes;
      else initialBytes += file.bytes;
      // Composition answers "what fills the package", so CDN content is out.
      const total = kinds.get(kind) ?? { kind, bytes: 0, count: 0 };
      total.bytes += file.bytes;
      total.count++;
      kinds.set(kind, total);
    }
  }

  const packageBytes = initialBytes + lazyBytes;
  const bySubpackage = new Map<string, number>();
  for (const file of entries) {
    if (file.bucket !== 'lazy') continue;
    const root = file.path.split('/').slice(0, 2).join('/');
    bySubpackage.set(root, (bySubpackage.get(root) ?? 0) + file.bytes);
  }
  const report: BuildSizeReport = {
    initialBytes, lazyBytes, remoteBytes, packageBytes, totalBytes,
    fileCount: entries.length,
    largest: [...entries].sort((a, b) => b.bytes - a.bytes).slice(0, LARGEST_FILES),
    byKind: [...kinds.values()].sort((a, b) => b.bytes - a.bytes),
    verdicts: [],
  };
  for (const [root, bytes] of bySubpackage) {
    if (!report.largestSubpackage || bytes > report.largestSubpackage.bytes) report.largestSubpackage = { root, bytes };
  }
  if (opts.deliverableBytes != null) {
    report.deliverableBytes = opts.deliverableBytes;
    if (opts.deliverableName) report.deliverableName = opts.deliverableName;
  }
  // Summed from the entries rather than passed in: a file the export packed and
  // then did not ship must not be counted as a saving.
  const packed = entries.filter((e) => e.sourceBytes !== undefined);
  if (packed.length > 0) {
    report.packing = {
      fromBytes: packed.reduce((n, e) => n + (e.sourceBytes ?? 0), 0),
      toBytes: packed.reduce((n, e) => n + e.bytes, 0),
      fileCount: packed.length,
    };
  }
  report.verdicts = judge(report, opts.budgets ?? []);
  return report;
}

/**
 * Judge the report against each limit in force.
 *
 * A `deliverable` limit on a build that produced no single upload file is
 * SKIPPED rather than judged against zero: an Android export that stopped at the
 * content payload has not yet made the thing the limit applies to, and reporting
 * it as comfortably under would be a lie of the most reassuring kind.
 */
function judge(report: BuildSizeReport, budgets: readonly SizeBudget[]): SizeVerdict[] {
  const verdicts: SizeVerdict[] = [];
  for (const budget of budgets) {
    const measured = budget.scope === 'initial' ? report.initialBytes
      : budget.scope === 'total' ? report.packageBytes
        : budget.scope === 'eachSubpackage' ? report.largestSubpackage?.bytes
          : report.deliverableBytes;
    if (measured == null) continue;
    verdicts.push(evaluateSizeBudget(measured, budget));
  }
  return verdicts;
}

/** Every file under `root`, with its size, relative to `root`. */
export async function collectBuildFiles(root: string): Promise<{ path: string; bytes: number }[]> {
  const out: { path: string; bytes: number }[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;  // vanished mid-walk / unreadable — a size report never fails a build
    }
    for (const item of items) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) await walk(abs, rel);
      else if (item.isFile()) {
        try {
          out.push({ path: rel, bytes: (await stat(abs)).size });
        } catch { /* same */ }
      }
    }
  };
  await walk(root, '');
  return out;
}

/**
 * Measure a finished build.
 *
 * `root` is what shipped — the payload dir, which for the desktop target is the
 * web build nested under `app/` rather than the Electron shell around it, since
 * the shell is the same weight for every game and tells a developer nothing.
 */
export async function measureBuild(opts: {
  root: string;
  platform: ExportPlatform;
  /** Limits the vendor / ad-network profile driving this export declares. */
  profileBudgets?: readonly SizeBudget[];
  /** `packaging.sizeBudget[platform]`, in bytes. */
  projectMaxBytes?: number;
  /**
   * Absolute path to the single uploaded file, when the target makes one.
   *
   * Weighed on its own; it does NOT exclude itself from the directory totals.
   * One that repackages loose files is already in {@link packages}, and the
   * playable's `index.html` IS the build — excluding it emptied the report.
   */
  deliverable?: string;
  /**
   * Absolute paths to packages written INSIDE `root` — the .apk, the .aab, the
   * playable's .zip, a desktop app DIRECTORY.
   *
   * Each is a repackaging of content that also sits beside it as loose files, so
   * counting both would double every byte and report a build at twice its
   * weight. They are measured on their own (as the deliverable) and left out of
   * the directory totals.
   *
   * This is the ONLY thing that excludes a file, so a caller that writes a new
   * kind of package has to name it here — which is the question being asked
   * ("does this repackage what is already there?"), rather than a proxy for it.
   */
  packages?: readonly string[];
  /**
   * Project-relative directories whose contents are a SUBPACKAGE — fetched at
   * startup, and off whatever cap the main package is judged against.
   *
   * Named by the export that staged them, for the reason `packages` is: a path
   * prefix would be a guess about what a vendor happens to call one.
   */
  subPackageRoots?: readonly string[];
  /**
   * A single-file target's file, and what it is made of — each span under the
   * path those bytes would carry loose. The file is replaced by its spans, so
   * it composes like every other target instead of weighing in as one nameless
   * `other`. Supplied by the assembly, which is where the bytes are joined.
   */
  inlineOf?: { file: string; parts: readonly { path: string; bytes: number }[] };
  /** The cook's `inclusion` map — why each asset is in the build. */
  inclusion?: Record<string, Inclusion>;
  /**
   * Compare against this platform's last build and leave the record for the next.
   * `projectRoot` is the PROJECT, not the output: the history outlives one build
   * and a shipped package must not carry it.
   */
  history?: { projectRoot: string; settings: SizeSettings };
  /**
   * Project-relative staged path → what that file weighed before this export
   * packed it. Only the export knows both numbers, and the report is the only
   * place anyone looks for them afterwards.
   */
  packedFrom?: Readonly<Record<string, number>>;
}): Promise<BuildSizeReport> {
  const excluded: string[] = [];
  for (const file of opts.packages ?? []) {
    const rel = path.relative(opts.root, file);
    // path-sandbox: not a boundary — classifying which built files a report counts.
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) excluded.push(normalizeRel(rel));
  }
  // By prefix, because a package is not always a file: a desktop build's package
  // is the assembled app DIRECTORY, and excluding only its own name would leave
  // every byte inside it counted a second time.
  const files = (await collectBuildFiles(opts.root))
    .filter((f) => !isUnder(normalizeRel(f.path), excluded))
    .flatMap((f) => (opts.inlineOf && normalizeRel(f.path) === normalizeRel(opts.inlineOf.file)
      ? [...opts.inlineOf.parts]
      : [f]));
  let manifest: unknown = null;
  try {
    manifest = JSON.parse(await readFile(path.join(opts.root, 'asset-manifest.json'), 'utf8'));
  } catch { /* no addressable manifest → everything is initial (see bucketIndexFrom) */ }

  let deliverableBytes: number | undefined;
  if (opts.deliverable) {
    try {
      const info = await stat(opts.deliverable);
      // A directory's own stat size is a few dozen bytes of bookkeeping, so a
      // desktop app measured that way reports as weightless — and passes every
      // limit. What ships is what is inside it.
      deliverableBytes = info.isDirectory()
        ? (await collectBuildFiles(opts.deliverable)).reduce((n, f) => n + f.bytes, 0)
        : info.size;
    } catch { /* not produced (no template installed) — the limit is then skipped */ }
  }

  // The manifest's own answer first; a subpackage root the export named wins
  // over the default, since nothing in the manifest claims the engine binary.
  const buckets = bucketIndexFrom(manifest);
  const roots = (opts.subPackageRoots ?? []).map((r) => `${normalizeRel(r)}/`);
  if (roots.length > 0) {
    for (const f of files) {
      const rel = normalizeRel(f.path);
      if (roots.some((r) => rel.startsWith(r))) buckets.set(rel, 'lazy');
    }
  }
  const entries = entriesOf(files, {
    buckets,
    logical: logicalIndexFrom(manifest),
    inclusion: opts.inclusion,
    packedFrom: opts.packedFrom,
  });
  const report = summarizeEntries(entries, {
    budgets: resolveSizeBudgets(opts.platform, {
      profile: opts.profileBudgets,
      projectMaxBytes: opts.projectMaxBytes,
    }),
    deliverableBytes,
    deliverableName: opts.deliverable ? path.basename(opts.deliverable) : undefined,
  });

  if (opts.history) {
    const record = recordOf(report, opts.platform, opts.history.settings, entries);
    const previous = await readSizeRecord(opts.history.projectRoot, opts.platform);
    if (previous) report.since = compareSizes(previous, record);
    // Written after the comparison, so a failed write leaves the last good record
    // rather than a half-written one this build would then compare against.
    await writeSizeRecord(opts.history.projectRoot, opts.platform, record);
  }
  return report;
}
