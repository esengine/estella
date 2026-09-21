// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  logicSupport.ts — what a build that ships script graphs tells the core.
 *
 * A call, not a file's side effect — see spine/spineSupport.ts. The loader
 * names this subsystem's compiler, so one the asset registry constructs is one
 * every package carries.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { addAssetLoader } from '../asset/optionalLoaders';
import { ScriptGraphPlugin } from './ScriptGraphPlugin';
import { ScriptGraphAssetLoader } from '../asset/loaders/ScriptGraphAssetLoader';

export function registerScriptGraphSupport(): void {
  addEntryPlugin('logic', () => new ScriptGraphPlugin());
  addAssetLoader('scriptGraph', () => new ScriptGraphAssetLoader() as never);
}
