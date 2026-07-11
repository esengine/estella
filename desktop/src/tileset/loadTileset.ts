// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    loadTileset.ts
 * @brief   Read + parse an `.estileset` from disk into a `TilesetAsset`. The one
 *          place the fs.read → JSON.parse → parseTileset chain lives, so the
 *          painter's palette loader isn't a second, drifting copy of it.
 */
import { parseTileset, type TilesetAsset } from 'esengine';

/** Load and parse an `.estileset` at `path` (throws on unreadable/invalid JSON). */
export async function loadTilesetAsset(path: string): Promise<TilesetAsset> {
  return parseTileset(JSON.parse(await window.estella.fs.read(path)));
}
