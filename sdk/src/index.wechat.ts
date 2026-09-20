// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.wechat.ts
 * @brief   ESEngine SDK - WeChat MiniGame entry point
 *
 * The whole entry: everything in index.wechat.base plus every optional
 * subsystem. `index.wechat.lean` is the same base with none of them, for a
 * package that imports back only what its project uses.
 */
import { installOptionalPlugins } from './runtime/optionalPlugins';

installOptionalPlugins();

export * from './index.wechat.base';
