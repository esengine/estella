// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   ESEngine SDK - Web entry point (auto-initializes Web platform)
 *
 * The whole entry: everything in index.base plus every optional subsystem.
 * `index.lean` is the same base with none of them, for a package that imports
 * back only what its project uses.
 */
import { installOptionalPlugins } from './runtime/optionalPlugins';
import { installWebEntry } from './runtime/webEntry';

installOptionalPlugins();
installWebEntry();

export * from './index.base';
