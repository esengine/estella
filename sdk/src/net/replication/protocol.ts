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
 */
import type { SceneComponentData } from '../../scene/scene';

/**
 * 4: a spawn stopped being a scene snapshot. It now carries protocol identity,
 * a ghost-construction key, and a baseline of DECLARED replication fields only —
 * a v3 endpoint would read the same JSON and build a different world, which is
 * exactly what a version is for.
 */
export const REPLICATION_PROTOCOL_VERSION = 4;

/** NetChannel binary channel id the snapshot frames ride on. */
export const REPLICATION_CHANNEL = 1;

/** Control-plane message types (NetChannel event / request names). */
export const ReplMsg = {
    hello: 'repl:hello',
    spawn: 'repl:spawn',
    despawn: 'repl:despawn',
    componentRemove: 'repl:crm',
    input: 'repl:input',
    ack: 'repl:ack',
} as const;

/**
 * One component's replication schema, as exchanged for handshake comparison.
 * `shapes` is parallel to `fields`: each field's wire shape as a canonical
 * signature. Names alone do not pin the byte layout — `0` against `false`
 * agrees on the name and writes 4 bytes against 1.
 */
export interface ReplComponentSchema {
    name: string;
    fields: string[];
    shapes: string[];
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
    /** The server's fixed timestep in seconds (0 if it hasn't ticked yet) —
     *  the dt client prediction replays unacknowledged inputs with. */
    fixedDelta: number;
}

export interface ReplHelloError {
    ok: false;
    error: string;
}

export type ReplHelloResponse = ReplHelloOk | ReplHelloError;

/**
 * One replicated entity's spawn, in the three contracts it is actually made of.
 * Identity is protocol, not state; construction is declared, not inferred from
 * what the authority holds; and the baseline carries replication-table
 * components with their DECLARED fields and nothing else.
 */
export interface ReplSpawnEntity {
    netId: number;
    name: string;
    /** netId of the replicated parent, or 0 for a root. */
    parentNetId: number;
    /** Owning connection id. Protocol identity like `netId` — it is not a
     *  replicated field and must not become one. */
    owner: number;
    /** Which registered archetype builds this ghost; '' for a bare one. */
    archetype: string;
    /** Table components only, declared fields only; entity refs as netIds. */
    baseline: SceneComponentData[];
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
 * Server → client: replicated components that LEFT an entity that lives on.
 * Field deltas cannot carry this — a removed component stops being sampled, so
 * without its own op the client keeps the last values it saw for good.
 * `componentIds` are wire table ids (codec.ts), the same ids frames carry.
 */
export interface ReplComponentRemoveBatch {
    tick: number;
    entries: { netId: number; componentIds: number[] }[];
}

/**
 * Client → server input command. `actions` is game-defined (typically one
 * InputMap's evaluated values per fixed tick: booleans, axes, {x,y} pairs);
 * `seq` is a client-monotonic counter so stale deliveries never overwrite
 * newer state. The server keeps the latest per connection for gameplay that
 * reads `ReplicationServer.inputOf(connectionId)`, and additionally queues
 * commands for exactly-once per-tick consumption via `tickInputOf` — the
 * contract client prediction replays against.
 */
export interface ReplInputMsg {
    seq: number;
    actions: Record<string, unknown>;
}

/**
 * Server → client input acknowledgement: the authoritative state at `tick`
 * incorporates this connection's inputs up to and including `seq`. Client
 * prediction drops acknowledged inputs and replays the rest on top of the
 * authoritative state. Sent only when the acknowledged seq advances.
 */
export interface ReplAckMsg {
    tick: number;
    seq: number;
}
