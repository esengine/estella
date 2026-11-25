// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { mkdir, writeFile } from 'node:fs/promises';
import { isInsideRoot, resolveInside } from '../fs/pathSandbox';
import { adoptOrphan, metaUuidOf, recordImportSource, releaseImportSource } from './assetMeta';
import { META_EXT } from './contentPolicy';

export interface SourceFileLocation {
  root: string;
  /** Source project's settings and image references when the requested output is standalone. */
  projectRoot?: string;
  /** Project-relative directory for the products. */
  destDir: string;
  absSource: string;
  /** The editor captures the previous file and sidecar for undo. */
  beforeWrite?(rel: string): Promise<void> | void;
}

/** All generated files keep their identity on reimport and point back to their source.
 *  Files merely referenced by a source, such as a cube face, remain independently owned. */
export async function sourceProductWriter({ root, destDir, absSource, beforeWrite }: SourceFileLocation) {
  const absDir = resolveInside(root, destDir, 'project root');
  await mkdir(absDir, { recursive: true });
  let sourceUuid: string | null = null;
  if (isInsideRoot(root, absSource)) {
    await adoptOrphan(absSource);
    sourceUuid = await metaUuidOf(absSource);
  }
  const products: string[] = [];
  async function write(name: string, bytes: Uint8Array | string,
                       settle: (abs: string) => Promise<unknown> = adoptOrphan,
                       prepare?: (abs: string) => Promise<void>): Promise<string> {
    const rel = destDir ? `${destDir}/${name}` : name;
    const abs = resolveInside(absDir, name, 'product directory');
    resolveInside(absDir, name + META_EXT, 'product directory');
    await beforeWrite?.(rel);
    await prepare?.(abs);
    await writeFile(abs, bytes);
    await settle(abs);
    if (sourceUuid) await recordImportSource(abs, sourceUuid);
    products.push(rel);
    return rel;
  }
  async function release(name: string): Promise<boolean> {
    if (!sourceUuid) return false;
    const abs = resolveInside(absDir, name, 'product directory');
    resolveInside(absDir, name + META_EXT, 'product directory');
    return releaseImportSource(abs, sourceUuid, () => beforeWrite?.(destDir ? destDir + '/' + name : name));
  }
  return { absDir, sourceUuid, products, write, release };
}
