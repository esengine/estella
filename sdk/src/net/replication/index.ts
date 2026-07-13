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
    type ReplInputMsg,
} from './protocol';
export {
    buildReplicationTable,
    tableSchemas,
    diffSchemas,
    encodeValue,
    decodeValue,
    decodeStateFrame,
    ByteWriter,
    ByteReader,
    FrameWriter,
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
    type InterestPolicy,
    type InterestView,
    type RadiusInterestOptions,
} from './interest';
export { NetIds } from './NetIds';
export { ReplicationServer } from './server';
export { ReplicationClient, type ReplicationClientOptions } from './client';
export { lerpValue, InterpolationState, ComponentBuffer } from './interpolation';
export {
    ReplicationPlugin,
    replicationPlugin,
    NetSession,
    Net,
    type NetRoleKind,
} from './ReplicationPlugin';
