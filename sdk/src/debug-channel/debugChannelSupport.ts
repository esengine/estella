// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  debugChannelSupport.ts — hands the runtime the channel it starts for a
 *        development build.
 */
import { setDebugChannelImpl } from '../runtime/debugChannelHook';
import { startDebugChannel, attachDebugChannel } from '../runtime/debugChannel';

export function registerDebugChannelSupport(): void {
    setDebugChannelImpl({ start: startDebugChannel, attach: attachDebugChannel });
}
