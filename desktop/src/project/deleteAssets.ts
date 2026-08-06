// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    deleteAssets.ts
 * @brief   Removing project files — the one door, for the Content Browser and for a driver.
 *
 * Deleting is two steps that must not come apart: the file (and its `.meta`) goes to the OS
 * trash, and the asset registry is re-scanned. Skip the second and every `@uuid:` ref to the
 * dead asset keeps resolving out of a stale index until something reloads — the file is gone
 * and the editor still believes in it.
 *
 * Batch-shaped because both callers are: the panel deletes a selection, and one re-scan for
 * the whole batch is the difference between a delete and a freeze on a folder of sprites. A
 * failure on one path is reported in its own row rather than aborting the rest — a permission
 * error on the third file must not leave the first two deleted and unaccounted for.
 *
 * The re-scan is INCREMENTAL: we know exactly which paths went, and a full walk is O(every
 * file in the project) — seconds on an asset-heavy one. Removing a folder still falls back to
 * the full walk (its children were never named), which the incremental door decides, not us.
 */
import { ProjectStore } from './ProjectStore';

export interface TrashedAsset {
  path: string;
  /** Restore token for `window.estella.fs.restoreTrashed` — null when the delete failed. */
  token: string | null;
  /** Why this one did not go, when it did not. */
  error?: string;
}

/**
 * Trash `paths` (files or folders, project-relative) and re-scan the registry once.
 *
 * The trash is the OS one: recoverable by hand, and by `restoreTrashed` with the returned
 * token for as long as the pre-trash snapshot lives.
 */
export async function deleteAssets(paths: readonly string[]): Promise<TrashedAsset[]> {
  const results: TrashedAsset[] = [];
  for (const path of paths) {
    try {
      results.push({ path, token: await window.estella.fs.trash(path) });
    } catch (err) {
      results.push({ path, token: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const gone = results.filter((r) => r.token !== null).map((r) => r.path);
  if (gone.length > 0) await ProjectStore.applyDiskChanges(gone);
  return results;
}
