// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  index.ts — `esengine/debug-channel`: importing it gives a development
 *        build its line to the editor. The export adds the import to a package
 *        that names an editor, and to no other.
 */
import { registerDebugChannelSupport } from './debugChannelSupport';

registerDebugChannelSupport();
