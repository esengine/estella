// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    protocol.ts
 * @brief   The replication wire contract — one dependency-free module both
 *          endpoints import (the playProtocol pattern). The control plane
 *          rides NetChannel JSON events/RPC; the state plane rides the binary
 *          channel {@link REPLICATION_CHANNEL} (see codec.ts for the frame
 *          layout). Version or schema drift refuses the connection at
 *          handshake — never a silently mismatched simulation.
 *
 * @beta   Pre-1.0 networking: client prediction will reshape this surface.
 */
import type { SceneComponentData } from '../../scene';

export const REPLICATION_PROTOCOL_VERSION = 1;

/** NetChannel binary channel id the snapshot frames ride on. */
export const REPLICATION_CHANNEL = 1;

/** Control-plane message types (NetChannel event / request names). */
export const ReplMsg = {
    hello: 'repl:hello',
    spawn: 'repl:spawn',
    despawn: 'repl:despawn',
    input: 'repl:input',
} as const;

/** One component's replication schema, as exchanged for handshake comparison. */
export interface ReplComponentSchema {
    name: string;
    fields: string[];
}

export interface ReplHelloRequest {
    protocolVersion: number;
    /** EHT layout hash — builtins replicate by heap layout, so both ends must
     *  run the same component ABI. */
    abiHash: string;
    /** The client's full replication table, for exact schema comparison. */
    components: ReplComponentSchema[];
}

export interface ReplHelloOk {
    ok: true;
    /** Server-assigned connection id — the ownership handle (0 = the server). */
    connectionId: number;
    /** The server's current fixed tick, so the client can offset its buffers. */
    tick: number;
    fixedDelta: number;
}

export interface ReplHelloError {
    ok: false;
    error: string;
}

export type ReplHelloResponse = ReplHelloOk | ReplHelloError;

/** One replicated entity's spawn payload. Component data is the scene
 *  serialization shape (loadComponent applies it, out-of-band codecs and
 *  validation included); entity-ref fields arrive rewritten to netIds. */
export interface ReplSpawnEntity {
    netId: number;
    name: string;
    /** netId of the replicated parent, or 0 for a root. */
    parentNetId: number;
    components: SceneComponentData[];
}

export interface ReplSpawnBatch {
    tick: number;
    entities: ReplSpawnEntity[];
}

export interface ReplDespawnBatch {
    tick: number;
    netIds: number[];
}

/**
 * Client → server input command. `actions` is game-defined (typically one
 * InputMap's evaluated values per fixed tick: booleans, axes, {x,y} pairs);
 * `seq` is a client-monotonic counter so stale deliveries never overwrite
 * newer state. The server keeps the latest per connection and gameplay reads
 * it via `ReplicationServer.inputOf(connectionId)`.
 */
export interface ReplInputMsg {
    seq: number;
    actions: Record<string, unknown>;
}
