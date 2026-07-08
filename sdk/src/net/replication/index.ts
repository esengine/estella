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
export { NetIds } from './NetIds';
export { ReplicationServer } from './server';
export { ReplicationClient } from './client';
export {
    ReplicationPlugin,
    replicationPlugin,
    NetSession,
    Net,
    type NetRoleKind,
} from './ReplicationPlugin';
