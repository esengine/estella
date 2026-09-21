// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Networking barrel: sockets, transports, NetChannel, replication.
 */
export { GameSocket, type GameSocketOptions, type SocketReadyState } from './GameSocket';
export { MiniGameSocket } from './MiniGameSocket';
export { WeChatSocket } from './WeChatSocket';
export {
    NetChannel,
    type NetTransport,
    type ReliableOrderedTransport,
    type NetChannelOptions,
    type MessageHandler,
    type RequestHandler,
    type BinaryHandler,
} from './NetChannel';
export { MemoryTransport, createMemoryTransportPair } from './MemoryTransport';
export { MessagePortTransport, type MessagePortLike } from './MessagePortTransport';
export type {
    PlatformSocket,
    PlatformSocketEvents,
    PlatformSocketOptions,
    PlatformSocketReadyState,
} from '../platform/types';
export * from './replication';
export { createSocket } from './createSocket';
