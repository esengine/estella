// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  optionalPlugins.ts — the entry-point side of the optional subsystems.
 *
 * Importing this file IS the decision to ship Spine and DragonBones: it is the
 * only place that reaches them from the runtime, so a build that leaves it out
 * leaves their code out too. A mini-game inlines the SDK, and measured on
 * examples/hello-world these two are 110KB of a package using neither.
 *
 * Every entry point imports it for its side effect. One that deliberately does
 * not is a lean entry, and `check-entries-install-options` is what keeps the
 * difference from being an accident.
 */
import { SpinePlugin } from '../spine';
import { DragonBonesPlugin } from '../dragonbones';
import { setEntryPlugins } from './entryPlugins';

setEntryPlugins(() => [new SpinePlugin(), new DragonBonesPlugin()]);
