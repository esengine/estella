// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Networking barrel: sockets, transports, NetChannel, replication.
 *
 * @beta   Pre-1.0 networking: client prediction and interest management will reshape this surface.
 */
export { GameSocket, type GameSocketOptions, type SocketReadyState } from './GameSocket';
export { WeChatSocket } from './WeChatSocket';
export {
    NetChannel,
    type NetTransport,
    type NetChannelOptions,
    type MessageHandler,
    type RequestHandler,
    type BinaryHandler,
} from './NetChannel';
export { MemoryTransport, createMemoryTransportPair } from './MemoryTransport';
export { MessagePortTransport, type MessagePortLike } from './MessagePortTransport';
export type { PlatformSocket, PlatformSocketOptions, PlatformSocketReadyState } from '../platform/types';
export * from './replication';

import { GameSocket, type GameSocketOptions } from './GameSocket';
import { isPlatformInitialized, getPlatform } from '../platform/base';
import type { PlatformSocket } from '../platform/types';

/**
 * Open a socket through the platform adapter (web → WebSocket, wechat →
 * wx.connectSocket, node → ws). A platform without networking fails loud; a
 * bare host with no adapter set (unit tests) falls back to the browser socket.
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
