// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tilemapSupport.ts — what a build that ships tilemaps tells the core.
 *
 * A call, not a file's side effect — see spine/spineSupport.ts. Both halves come
 * from here: the plugin an app installs, and the loaders that read a `.tmj` and
 * a tileset. A loader names its subsystem's parser, so one the asset registry
 * constructs is one every package carries.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { addAssetLoader } from '../asset/optionalLoaders';
import { TilemapPlugin } from './tilemapPlugin';
import { TilemapAssetLoader } from '../asset/loaders/TilemapAssetLoader';
import { TilesetAssetLoader } from '../asset/loaders/TilesetAssetLoader';

export function registerTilemapSupport(): void {
  addEntryPlugin('tilemap', () => new TilemapPlugin());
  addAssetLoader('tilemap', () => new TilemapAssetLoader() as never);
  addAssetLoader('tileset', () => new TilesetAssetLoader() as never);
}
