// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AddressableManifest } from 'esengine';
import { physicalAssetFiles } from '../../../sdk/src/asset/physicalAssetFiles';
import { containsPath, isInsideRoot, realPathOf } from '../fs/pathSandbox';

/** Physical files owned by the exported manifest; shared pack files count once. */
export async function exportedAssetFiles(output: string): Promise<Set<string>> {
  let manifest: AddressableManifest;
  try {
    manifest = JSON.parse(await readFile(path.join(output, 'asset-manifest.json'), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || err instanceof SyntaxError) return new Set();
    throw err;
  }
  const files = new Set<string>();
  const base = path.resolve(output);
  for (const group of Object.values(manifest.groups ?? {})) {
    for (const asset of Object.values(group.assets ?? {})) {
      for (const { path: file } of physicalAssetFiles(asset)) {
        if (path.isAbsolute(file) || /^[a-z]+:/i.test(file)) continue;
        const target = path.resolve(output, file);
        if (target !== base && containsPath(base, target)) files.add(target);
      }
    }
  }
  return files;
}

/** Remove only previously shipped asset files absent from the current manifest. */
export async function pruneExportedAssets(output: string, project: string, previous: ReadonlySet<string>): Promise<void> {
  const current = await exportedAssetFiles(output);
  const stale = [...previous].filter((file) => !current.has(file));
  if (stale.length === 0) return;
  if (containsPath(realPathOf(output), realPathOf(project))) {
    throw new Error('asset cleanup requires a build output separate from the project source');
  }
  for (const file of stale) {
    if (isInsideRoot(output, file)) await rm(file, { force: true });
  }
}
