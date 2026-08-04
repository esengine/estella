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
import type { ExportPlatform } from '../src/project/platforms';
import {
  evaluateSizeBudget, resolveSizeBudgets,
  type SizeBudget, type SizeVerdict,
} from '../src/project/sizeBudget';

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

/** One file in the finished build. */
export interface BuildSizeEntry {
  /** Path relative to the measured root, in POSIX form (the shipped shape). */
  path: string;
  bytes: number;
  bucket: SizeBucket;
  kind: SizeKind;
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
  /** Largest first, capped at {@link LARGEST_FILES}. */
  largest: BuildSizeEntry[];
  /** Package composition (initial + lazy), largest kind first. Excludes remote:
   *  the question this answers is what fills the PACKAGE. */
  byKind: KindTotal[];
  /** Every limit in force, judged. Empty when the target declares none and the
   *  project set no budget. */
  verdicts: SizeVerdict[];
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
  } = {},
): BuildSizeReport {
  const buckets = opts.buckets ?? new Map<string, SizeBucket>();
  const entries: BuildSizeEntry[] = [];
  let initialBytes = 0, lazyBytes = 0, remoteBytes = 0, totalBytes = 0;
  const kinds = new Map<SizeKind, KindTotal>();

  for (const file of files) {
    const rel = normalizeRel(file.path);
    if (NOT_SHIPPED.has(rel) || isSourceMap(rel)) continue;
    const bucket = buckets.get(rel) ?? 'initial';
    const kind = kindOf(rel);
    entries.push({ path: rel, bytes: file.bytes, bucket, kind });
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
  const report: BuildSizeReport = {
    initialBytes, lazyBytes, remoteBytes, packageBytes, totalBytes,
    fileCount: entries.length,
    largest: [...entries].sort((a, b) => b.bytes - a.bytes).slice(0, LARGEST_FILES),
    byKind: [...kinds.values()].sort((a, b) => b.bytes - a.bytes),
    verdicts: [],
  };
  if (opts.deliverableBytes != null) {
    report.deliverableBytes = opts.deliverableBytes;
    if (opts.deliverableName) report.deliverableName = opts.deliverableName;
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
  /** Absolute path to the single uploaded file, when the target makes one. */
  deliverable?: string;
  /**
   * Absolute paths to packages written INSIDE `root` — the .apk, the .aab, the
   * playable's .zip.
   *
   * Each is a repackaging of content that also sits beside it as loose files, so
   * counting both would double every byte and report a build at twice its
   * weight. They are measured on their own (as the deliverable) and left out of
   * the directory totals.
   */
  packages?: readonly string[];
}): Promise<BuildSizeReport> {
  const excluded = new Set<string>();
  for (const file of [...(opts.packages ?? []), ...(opts.deliverable ? [opts.deliverable] : [])]) {
    const rel = path.relative(opts.root, file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) excluded.add(normalizeRel(rel));
  }
  const files = (await collectBuildFiles(opts.root)).filter((f) => !excluded.has(normalizeRel(f.path)));
  let manifest: unknown = null;
  try {
    manifest = JSON.parse(await readFile(path.join(opts.root, 'asset-manifest.json'), 'utf8'));
  } catch { /* no addressable manifest → everything is initial (see bucketIndexFrom) */ }

  let deliverableBytes: number | undefined;
  if (opts.deliverable) {
    try {
      deliverableBytes = (await stat(opts.deliverable)).size;
    } catch { /* not produced (no template installed) — the limit is then skipped */ }
  }

  return summarizeBuildFiles(files, {
    buckets: bucketIndexFrom(manifest),
    budgets: resolveSizeBudgets(opts.platform, {
      profile: opts.profileBudgets,
      projectMaxBytes: opts.projectMaxBytes,
    }),
    deliverableBytes,
    deliverableName: opts.deliverable ? path.basename(opts.deliverable) : undefined,
  });
}
