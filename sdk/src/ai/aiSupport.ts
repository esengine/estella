// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  aiSupport.ts — what a build that ships gameplay AI tells the core.
 *
 * A call, not a file's side effect — see spine/spineSupport.ts. The action
 * vocabulary (`aiRegistry`) stays in the core, because authored event bindings
 * and UI controllers write verbs into it without any of this: what moves is the
 * navigation, perception, state-machine and behaviour-tree runtimes behind it.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { addAssetLoader } from '../asset/optionalLoaders';
// From each plugin's own module, not from './index': the barrel calls this at
// the end of its own evaluation, and a support module that reads the barrel back
// is a cycle whose bindings are not ready when the call lands.
import { NavPlugin } from './nav/NavPlugin';
import { FsmPlugin } from './fsm/FsmPlugin';
import { BtPlugin } from './bt/BtPlugin';
import { PerceptionPlugin } from './perception/PerceptionPlugin';
import { FsmAssetLoader } from '../asset/loaders/FsmAssetLoader';
import { BtAssetLoader } from '../asset/loaders/BtAssetLoader';

export function registerAiSupport(): void {
  addEntryPlugin('ai:nav', () => new NavPlugin());
  addEntryPlugin('ai:fsm', () => new FsmPlugin());
  addEntryPlugin('ai:bt', () => new BtPlugin());
  addEntryPlugin('ai:perception', () => new PerceptionPlugin());
  addAssetLoader('fsm', () => new FsmAssetLoader() as never);
  addAssetLoader('bt', () => new BtAssetLoader() as never);
}
