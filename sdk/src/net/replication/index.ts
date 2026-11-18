// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    REPLICATION_PROTOCOL_VERSION,
    REPLICATION_CHANNEL,
    ReplMsg,
    type ReplComponentSchema,
    type ReplHelloRequest,
    type ReplHelloResponse,
    type ReplSpawnEntity,
    type ReplSpawnBatch,
    type ReplDespawnBatch,
    type ReplComponentRemoveBatch,
    type ReplInputMsg,
    type ReplAckMsg,
    type ReplClosedMsg,
    type ReplGameMsg,
    type ReplCloseReason,
} from './protocol';
export {
    buildReplicationTable,
    tableSchemas,
    shapeSignature,
    diffSchemas,
    encodeValue,
    decodeValue,
    cloneValue,
    decodeStateFrame,
    ByteWriter,
    ByteReader,
    FrameWriter,
    quantizeReplicatedFields,
    type FieldShape,
    type ReplicationTable,
    type ReplicationTableEntry,
    type EntityRefMap,
    type StateEntry,
    type StateFrame,
} from './codec';
export { Replicated, NetGhost, type ReplicatedData } from './components';
export {
    radiusInterest,
    radiusInterestProvider,
    type InterestPolicy,
    type InterestView,
    type InterestProvider,
    type InterestProviderPrepareView,
    type InterestProviderQueryView,
    type PreparedInterest,
    type RadiusInterestOptions,
    type InterestPoint,
} from './interest';
export { registerReplicationArchetype, type ReplicationArchetype } from './archetype';
export { NetIds } from './NetIds';
export {
    ReplicationServer,
    ReplicationRedirect,
    type ReplicationServerOptions,
    type ReplicationPlayer,
    type ReplicationBudgetOptions,
    type ReplicationPriorityView,
    type ReplicationHelloInfo,
    type ReplicationTransferTarget,
    type ReplicationLimits,
} from './server';
export {
    ReplicationClient,
    predictionReplays,
    type ReplicationClientOptions,
    type ReplicationClientState,
    type ReplicationReconnectOptions,
    type PredictionOptions,
    type PredictionSmoothing,
} from './client';
export { lerpValue, InterpolationState, ComponentBuffer } from './interpolation';
export {
    ReplicationPlugin,
    replicationPlugin,
    NetSession,
    Net,
    type NetRoleKind,
} from './ReplicationPlugin';

// The channel and the transports a game drives replication over: they chunk
// with the protocol, so this is where a package pays for them.
export {
    NetChannel,
    type NetChannelOptions, type MessageHandler, type RequestHandler, type BinaryHandler,
} from '../NetChannel';
export { MemoryTransport, createMemoryTransportPair } from '../MemoryTransport';
export { MessagePortTransport, type MessagePortLike } from '../MessagePortTransport';
export { webSocketTransport, type ServerWebSocketLike, type WebSocketTransportOptions } from '../webSocketTransport';
export { startSocketWorker, type SocketWorker, type SocketWorkerOptions, type WorkerSocketTransport } from '../socketWorker';
