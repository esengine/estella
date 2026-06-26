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
import { writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { scanAssetDatabase, type AssetEntry } from './assetDb';

const MANIFEST = 'assets.manifest.json';

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
  opts: { entryScenes: string[]; outDir: string },
): Promise<CookResult> {
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
  // …then take the transitive closure over the dependency graph.
  while (queue.length > 0) {
    const uuid = queue.shift()!;
    for (const dep of index.deps[uuid] ?? []) seed(dep);
  }

  const absOut = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(root, opts.outDir);
  await mkdir(absOut, { recursive: true });

  // Stage each reachable asset's file + build the ship manifest.
  const manifestEntries: AssetEntry[] = [];
  for (const uuid of reachable) {
    const entry = byUuid.get(uuid);
    if (!entry) continue;
    const dst = path.join(absOut, entry.path);
    try {
      await mkdir(path.dirname(dst), { recursive: true });
      await copyFile(path.join(root, entry.path), dst);
      manifestEntries.push({
        uuid: entry.uuid,
        path: entry.path,
        type: entry.type,
        importer: entry.importer,
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
