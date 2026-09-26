// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the last build of this target weighed, so this one can say what moved.
 *
 *        A total is not an answer: "the package grew 3MB" sends a developer
 *        hunting, while "these four files are new and this texture doubled" is the
 *        fix. So the whole per-file record is kept per platform, beside the
 *        project rather than inside the build — a shipped package has no business
 *        carrying the last one's measurements.
 *
 *        The record also carries the SETTINGS that decide size (compression,
 *        content addressing, minification). Comparing a compressed build against
 *        an uncompressed one otherwise reads as a regression nobody caused, which
 *        is the one way a comparison like this becomes noise.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BuildSizeEntry, BuildSizeReport } from './sizeReport';
import type { ExportPlatform } from '../project/platforms';

/**
 * Build options that change what a package weighs WITHOUT changing what is in
 * it. A setting that ships different content belongs in the file diff, where a
 * developer can see which files moved; one that ships the same content packed
 * differently belongs here, or the next build reads it as a regression.
 */
export interface SizeSettings {
  contentAddressed?: boolean;
  compressTextures?: boolean;
  compressAudio?: boolean;
  atlasTextures?: boolean;
  minify?: boolean;
  sourcemap?: boolean;
  compressWasm?: boolean;
  engineSubpackage?: boolean;
  /** The export profile the build was made with, if any. */
  profile?: string;
}

/**
 * What each packaging setting does to a measurement: the {@link SizeSettings}
 * key recording it, `content` (the file diff is the honest answer), or `inert`.
 * Exhaustive over `ProjectPackaging` — three levers were recorded nowhere, so
 * flipping `compressWasm` moved 1.4MB and the report blamed content.
 */
export const PACKAGING_SIZE_ROLE: Readonly<Record<string, keyof SizeSettings | 'content' | 'inert'>> = {
    platform: 'inert',
    config: 'minify',
    sourceMaps: 'sourcemap',
    frameDebugger: 'content',
    openFolder: 'inert',
    orientation: 'inert',
    assetCompression: 'compressTextures',
    compressTextures: 'compressTextures',
    compressAudio: 'compressAudio',
    atlasTextures: 'atlasTextures',

    compressWasm: 'compressWasm',
    engineSubpackage: 'engineSubpackage',
    excludeScenes: 'content',
    modulesByPlatform: 'content',
    outDir: 'inert',
    sizeBudget: 'inert',
    appId: 'inert',
    icon: 'content',
    achievements: 'inert',
    // A logo is inlined into the page, so choosing one changes what ships.
    splash: 'content',
    platforms: 'content',
    profiles: 'profile',
};

/** The settings this build ran with, out of everything the export was given. */
export function sizeSettingsOf(opts: SizeSettings): SizeSettings {
    const keys: (keyof SizeSettings)[] = [
        'contentAddressed', 'compressTextures', 'compressAudio', 'atlasTextures',
        'minify', 'sourcemap', 'compressWasm', 'engineSubpackage', 'profile',
    ];
    const out: Record<string, unknown> = {};
    for (const k of keys) if (opts[k] !== undefined) out[k] = opts[k];
    return out as SizeSettings;
}

/** One build's measurement, as the history file stores it. */
export interface SizeRecord {
  /** ISO timestamp of the build that wrote it. */
  at: string;
  platform: ExportPlatform;
  settings: SizeSettings;
  initialBytes: number;
  lazyBytes: number;
  remoteBytes: number;
  packageBytes: number;
  totalBytes: number;
  fileCount: number;
  /** Every shipped file, not just the largest — this is what the next build diffs. */
  files: BuildSizeEntry[];
}

/** One file that is new, gone, or a different size than last build. */
export interface SizeChange {
  path: string;
  /** 0 when the file is gone. */
  bytes: number;
  /** 0 when the file is new. */
  wasBytes: number;
  /** Carried from the current build, so a grown file can say what pulled it in. */
  why?: BuildSizeEntry['why'];
}

/** This build against the last one of the same platform. */
export interface SizeComparison {
  /** When the build being compared against was made. */
  at: string;
  /**
   * Settings that differ between the two builds, by name. Non-empty means the
   * numbers below are not comparing the same thing being built two ways.
   */
  settingsChanged: string[];
  initialDelta: number;
  packageDelta: number;
  /** Biggest absolute change first, capped at {@link MOST_CHANGED}. */
  changes: SizeChange[];
}

/** How many changed files a comparison names. */
export const MOST_CHANGED = 12;

const RECORD_VERSION = 1;

/** Where a platform's last measurement sits: beside the project, not in the build. */
export function sizeRecordPath(projectRoot: string, platform: ExportPlatform): string {
  return path.join(projectRoot, '.esengine', 'build-size', `${platform}.json`);
}

/** The previous record, or null when this is the first build of this target. */
export async function readSizeRecord(
  projectRoot: string, platform: ExportPlatform,
): Promise<SizeRecord | null> {
  try {
    const raw = JSON.parse(await readFile(sizeRecordPath(projectRoot, platform), 'utf8')) as
      { version?: number; record?: SizeRecord };
    return raw.version === RECORD_VERSION && raw.record ? raw.record : null;
  } catch {
    return null;  // absent or unreadable — a first build, which compares to nothing
  }
}

export async function writeSizeRecord(
  projectRoot: string, platform: ExportPlatform, record: SizeRecord,
): Promise<void> {
  const file = sizeRecordPath(projectRoot, platform);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: RECORD_VERSION, record }, null, 2) + '\n');
}

/** The record this build leaves for the next one. */
export function recordOf(
  report: BuildSizeReport, platform: ExportPlatform, settings: SizeSettings, files: readonly BuildSizeEntry[],
  at = new Date().toISOString(),
): SizeRecord {
  return {
    at, platform, settings,
    initialBytes: report.initialBytes,
    lazyBytes: report.lazyBytes,
    remoteBytes: report.remoteBytes,
    packageBytes: report.packageBytes,
    totalBytes: report.totalBytes,
    fileCount: report.fileCount,
    files: [...files],
  };
}

/** Which settings the two builds disagree on. */
export function settingsDiff(before: SizeSettings, after: SizeSettings): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)] as (keyof SizeSettings)[]);
  return [...names].filter((name) => (before[name] ?? false) !== (after[name] ?? false)).sort();
}

/** This build's files against the previous record's. Pure — the tests drive it. */
export function compareSizes(previous: SizeRecord, current: SizeRecord): SizeComparison {
  const was = new Map(previous.files.map((f) => [f.path, f.bytes]));
  const changes: SizeChange[] = [];
  for (const file of current.files) {
    const before = was.get(file.path);
    if (before === file.bytes) { was.delete(file.path); continue; }
    changes.push({ path: file.path, bytes: file.bytes, wasBytes: before ?? 0, ...(file.why ? { why: file.why } : {}) });
    was.delete(file.path);
  }
  // Whatever is left was shipped last time and is not shipped now.
  for (const [p, bytes] of was) changes.push({ path: p, bytes: 0, wasBytes: bytes });
  changes.sort((a, b) => Math.abs(b.bytes - b.wasBytes) - Math.abs(a.bytes - a.wasBytes));
  return {
    at: previous.at,
    settingsChanged: settingsDiff(previous.settings, current.settings),
    initialDelta: current.initialBytes - previous.initialBytes,
    packageDelta: current.packageBytes - previous.packageBytes,
    changes: changes.slice(0, MOST_CHANGED),
  };
}
