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
// Single-source content hash (sdk/src/asset/contentHash.ts). Imported as source —
// no hand-mirrored copy — so the cook and the runtime agree by construction.
import { contentHashHex } from '../../sdk/src/asset/contentHash';

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
  opts: { entryScenes: string[]; outDir: string; contentAddressed?: boolean },
): Promise<CookResult> {
  const contentAddressed = opts.contentAddressed ?? false;
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

  // Stage each reachable asset's file + build the ship manifest. We read the
  // bytes (rather than copyFile) so we can content-hash exactly what ships — the
  // asset's physical identity. Once textures are encoded this naturally hashes the
  // ENCODED artifact (e.g. the .ktx2), since it hashes whatever bytes we stage.
  const manifestEntries: CookManifestEntry[] = [];
  const staged = new Set<string>();  // staged output paths, for content-addressed dedup
  for (const uuid of reachable) {
    const entry = byUuid.get(uuid);
    if (!entry) continue;
    try {
      const data = await readFile(path.join(root, entry.path));
      const hash = contentHashHex(data);
      // Content-addressed naming: leaf assets ship as assets/<hash><ext>, so
      // byte-identical assets collapse to one file (dedup) and the URL is immutable
      // — content changes yield a new name, so it is permanently cacheable. Scenes
      // keep their logical path: they're loaded by name and the exporters read +
      // transform them in place. Refs are by uuid, so renaming leaves is transparent.
      const useCA = contentAddressed && entry.type !== 'scene';
      const outRel = useCA ? `assets/${hash}${path.extname(entry.path)}` : entry.path;
      const dst = path.join(absOut, outRel);
      if (!staged.has(outRel)) {
        await mkdir(path.dirname(dst), { recursive: true });
        await writeFile(dst, data);
        staged.add(outRel);
      }
      manifestEntries.push({
        uuid: entry.uuid,
        path: outRel,
        type: entry.type,
        importer: entry.importer,
        contentHash: hash,
        size: data.byteLength,
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
