// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  createSocket.ts — open a socket through the platform adapter.
 *
 * Its own module rather than the networking barrel's: the barrel re-exports
 * replication, so anything that reaches it puts the protocol in the package.
 */
import { GameSocket, type GameSocketOptions } from './GameSocket';
import { isPlatformInitialized, getPlatform } from '../platform/base';
import type { PlatformSocket } from '../platform/types';

/**
 * Web → WebSocket, wechat → wx.connectSocket, node → ws. A platform without
 * networking fails loud; a bare host with no adapter set (unit tests) falls
 * back to the browser socket.
 */
export function createSocket(options: GameSocketOptions): PlatformSocket {
    if (isPlatformInitialized()) {
        const platform = getPlatform();
        if (!platform.createSocket) {
            throw new Error(`[net] platform "${platform.name}" has no socket support`);
        }
        return platform.createSocket(options);
    }
    return new GameSocket(options);
}
