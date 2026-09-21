// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gameplaySupport.ts — what a build that ships the gameplay runtime tells
 *        the core. A call, not a file's side effect — see spine/spineSupport.ts.
 *
 * From the plugin's own module rather than from './index': the barrel calls this
 * at the end of its own evaluation, and a support module reading the barrel back
 * is a cycle whose bindings are not ready when the call lands.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { GameplayPlugin } from './GameplayPlugin';

export function registerGameplaySupport(): void {
  addEntryPlugin('gameplay', () => new GameplayPlugin());
}
