// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  rig2dSupport.ts — what a build that ships 2D rig constraints tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { Rig2DPlugin } from './rig2dPlugin';

export function registerRig2DSupport(): void {
    addEntryPlugin('rig2d', () => new Rig2DPlugin());
}
