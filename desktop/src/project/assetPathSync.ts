// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetPathSync.ts
 * @brief Propagate an asset rename/move to in-memory holders of the OLD path:
 *        every open AssetDocument (tileset/flipbook/timeline/fsm/bt/material/
 *        materialgraph) and the tilemap painter's palette. `@uuid:` refs in the
 *        scene model survive a rename by design; these path-valued bindings are
 *        the ones that would silently go stale.
 */
import { AssetDocument } from '@/document/AssetDocument';
import { useTilemapPaint } from '@/store/tilemapPaintStore';
import { remapAssetPath } from './pathRemap';

/** Call after a successful fs.rename of `from` → `to` (file or folder). */
export function syncAssetPaths(from: string, to: string): void {
  for (const doc of AssetDocument.openDocuments()) doc.rebindPath(from, to);

  const s = useTilemapPaint.getState();
  const tilesets = s.tilesets.map((ts) => {
    const next = remapAssetPath(ts.path, from, to);
    return next ? { ...ts, path: next } : ts;
  });
  const changed = tilesets.some((ts, i) => ts !== s.tilesets[i]);
  const nextPath = s.tilesetPath ? remapAssetPath(s.tilesetPath, from, to) : null;
  if (changed || nextPath) {
    useTilemapPaint.setState({
      ...(changed ? { tilesets } : null),
      ...(nextPath ? { tilesetPath: nextPath } : null),
    });
  }
}
