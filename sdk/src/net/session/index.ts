// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   `esengine/session` — an online game's request/response layer: typed
 *          contracts, retry-safe requests, a reconnecting client session and the
 *          server host that authenticates and serves it. Independent of the
 *          engine's replication; built for asynchronous play where players act
 *          on a shared world without sharing a tick.
 */
export {
    NetChannel,
    NetRequestError,
    NET_RATE_LIMITED,
    NET_ATTEMPT_FAILED,
    type NetTransport,
    type ReliableOrderedTransport,
    type NetChannelOptions,
    type NetHeartbeatOptions,
    type NetLimitOptions,
    type NetViolation,
    type PayloadCodec,
    type RequestCodec,
    type WireFormat,
    type NetRequestErrorCode,
    type RequestOptions,
    type MessageHandler,
    type RequestHandler,
} from '../NetChannel';
export {
    MemoryIdempotencyStore,
    type IdempotencyStore,
    type IdempotencyBegin,
    type IdempotentOutcome,
    type MemoryIdempotencyOptions,
} from '../IdempotencyStore';
export {
    SESSION_PROTOCOL_VERSION,
    SESSION_HELLO,
    SessionCloseCode,
    type SessionHelloRequest,
    type SessionHelloResponse,
} from './protocol';
export {
    SessionHost,
    SessionRejected,
    type AcceptedConnection,
    type SessionContext,
    type SessionHostOptions,
    type SessionHandler,
    type ServerSession,
} from './SessionHost';
export {
    ClientSession,
    type ClientSessionOptions,
    type SessionBackoff,
    type SessionRequestOptions,
    type SessionState,
    type SessionWelcome,
} from './ClientSession';
export { acceptWebSocket, type WebSocketLike, type AcceptWebSocketOptions } from './acceptWebSocket';
export { s, SchemaError, type Schema, type Infer } from './schema';
export { proto, jsonCodec, type ProtoMessage, type ProtoSchema } from './proto';
export {
    defineContract,
    type Contract,
    type ContractClient,
    type ContractImpl,
    type RequestDef,
} from './contract';
