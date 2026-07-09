// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    server.ts
 * @brief   The authoritative endpoint. Owns connections (one NetChannel per
 *          transport), answers the handshake, and each fixed tick: replicates
 *          spawns/despawns of `Replicated` entities on the JSON control plane
 *          and diffs replicated fields against a shadow copy to broadcast a
 *          binary delta frame. WebSocket transports are reliable+ordered, so
 *          delta-since-last-send needs no ack protocol.
 *
 * @beta   Pre-1.0 networking: client prediction and interest management will reshape this surface.
 */
import type { World } from '../../world';
import type { Entity } from '../../types';
import { Name, Parent, getComponent } from '../../component';
import { ABI_LAYOUT_HASH } from '../../component.generated';
import { serializeEntityComponents, type SceneComponentData } from '../../scene';
import { NetChannel, type NetTransport } from '../NetChannel';
import { log } from '../../logger';
import {
    REPLICATION_CHANNEL, REPLICATION_PROTOCOL_VERSION, ReplMsg,
    type ReplDespawnBatch, type ReplHelloRequest, type ReplHelloResponse,
    type ReplInputMsg, type ReplSpawnBatch, type ReplSpawnEntity,
} from './protocol';
import {
    buildReplicationTable, diffSchemas, tableSchemas, FrameWriter,
    type EntityRefMap, type ReplicationTable,
} from './codec';
import { Replicated, type ReplicatedData } from './components';
import { NetIds } from './NetIds';

interface Connection {
    id: number;
    channel: NetChannel;
    /** Handshake completed and the initial world spawn has been sent. */
    ready: boolean;
    /** Latest input command from this connection (stale seq never overwrites). */
    input: ReplInputMsg | null;
}

function deepClone<T>(v: T): T {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(deepClone) as T;
    const out: Record<string, unknown> = {};
    for (const k in v) out[k] = deepClone((v as Record<string, unknown>)[k]);
    return out as T;
}

function fieldEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra);
    if (ka.length !== Object.keys(rb).length) return false;
    for (const k of ka) if (!fieldEqual(ra[k], rb[k])) return false;
    return true;
}

export class ReplicationServer {
    private readonly world_: World;
    private readonly netIds_ = new NetIds();
    private readonly connections_ = new Map<number, Connection>();
    private nextConnectionId_ = 1;
    private table_: ReplicationTable | null = null;
    /** Last broadcast value per entity × table entry: entity → componentId → field record. */
    private readonly shadow_ = new Map<Entity, Map<number, Record<string, unknown>>>();
    private readonly known_ = new Set<Entity>();
    /** known entity → netId, owned by sampling. Survives the onDespawn hook
     *  clearing netIds_, so a despawn can still broadcast its id. */
    private readonly knownNetIds_ = new Map<Entity, number>();
    private tick_ = 0;

    constructor(world: World) {
        this.world_ = world;
        world.onDespawn((e) => {
            // Sampling handles replicated despawns; this catches direct holes.
            this.netIds_.unregisterEntity(e);
        });
    }

    /** Lazily built so components defined after plugin install still count. */
    get table(): ReplicationTable {
        return (this.table_ ??= buildReplicationTable());
    }

    get netIds(): NetIds {
        return this.netIds_;
    }

    get connectionCount(): number {
        return this.connections_.size;
    }

    /** Ready (handshaken) connection ids. Gameplay polls this each fixed tick
     *  to provision/retire per-player entities — no callback wiring needed. */
    get clientIds(): number[] {
        const out: number[] = [];
        for (const c of this.connections_.values()) {
            if (c.ready) out.push(c.id);
        }
        return out;
    }

    private get refs_(): EntityRefMap {
        return {
            toWire: (entity) => this.netIds_.netIdOf(entity as Entity) ?? 0,
            fromWire: (netId) => (this.netIds_.entityOf(netId) as number | undefined) ?? 0,
        };
    }

    /** Accept a transport (server-side end of one client link). */
    attachConnection(transport: NetTransport): number {
        const id = this.nextConnectionId_++;
        const channel = new NetChannel(transport);
        const conn: Connection = { id, channel, ready: false, input: null };
        this.connections_.set(id, conn);

        channel.on<ReplInputMsg>(ReplMsg.input, (msg) => {
            if (!conn.input || msg.seq > conn.input.seq) conn.input = msg;
        });

        channel.handle<ReplHelloRequest, ReplHelloResponse>(ReplMsg.hello, (req) => {
            if (req.protocolVersion !== REPLICATION_PROTOCOL_VERSION) {
                return { ok: false, error: `protocol v${req.protocolVersion}, server runs v${REPLICATION_PROTOCOL_VERSION}` };
            }
            if (req.abiHash !== ABI_LAYOUT_HASH) {
                return { ok: false, error: 'component ABI hash mismatch — client and server run different builds' };
            }
            const mismatch = diffSchemas(tableSchemas(this.table), req.components);
            if (mismatch) {
                return { ok: false, error: `replication schema mismatch: ${mismatch}` };
            }
            // The initial world spawn goes out on the next microtask — after this
            // response is on the wire — and flips the connection hot.
            Promise.resolve().then(() => this.sendInitialState_(conn));
            return { ok: true, connectionId: id, tick: this.tick_, fixedDelta: 0 };
        });

        return id;
    }

    detachConnection(id: number): void {
        const conn = this.connections_.get(id);
        if (!conn) return;
        conn.channel.dispose();
        this.connections_.delete(id);
    }

    /** The latest input command a connection sent (null before the first).
     *  Gameplay reads this in FixedUpdate and applies it to the entities the
     *  connection owns (Replicated.owner). */
    inputOf(connectionId: number): ReplInputMsg | null {
        return this.connections_.get(connectionId)?.input ?? null;
    }

    /** One replication tick: spawns/despawns on the control plane, dirty
     *  fields as one binary delta frame. Runs in FixedPostUpdate. */
    sample(tick: number): void {
        this.tick_ = tick;
        if (this.connections_.size === 0) return;

        const current = this.world_.getEntitiesWithComponents([Replicated]);
        const currentSet = new Set(current);

        const spawned: ReplSpawnEntity[] = [];
        for (const e of current) {
            if (!this.known_.has(e)) {
                spawned.push(this.registerEntity_(e));
            }
        }

        const despawnedIds: number[] = [];
        for (const e of [...this.known_]) {
            if (!currentSet.has(e) || !this.world_.valid(e)) {
                const netId = this.knownNetIds_.get(e);
                if (netId !== undefined) {
                    despawnedIds.push(netId);
                    this.netIds_.unregister(netId);
                }
                this.known_.delete(e);
                this.knownNetIds_.delete(e);
                this.shadow_.delete(e);
            }
        }

        if (spawned.length > 0) {
            this.broadcast_((c) => c.channel.send<ReplSpawnBatch>(ReplMsg.spawn, { tick, entities: spawned }));
        }
        if (despawnedIds.length > 0) {
            this.broadcast_((c) => c.channel.send<ReplDespawnBatch>(ReplMsg.despawn, { tick, netIds: despawnedIds }));
        }

        const frame = new FrameWriter(tick);
        for (const e of this.known_) {
            this.diffEntity_(e, frame);
        }
        if (frame.entryCount > 0) {
            const payload = frame.finish();
            this.broadcast_((c) => c.channel.sendBinary(REPLICATION_CHANNEL, payload));
        }
    }

    private registerEntity_(e: Entity): ReplSpawnEntity {
        const repl = this.world_.tryGet(e, Replicated) as ReplicatedData;
        if (repl.netId === 0) {
            repl.netId = this.netIds_.allocate();
            this.world_.set(e, Replicated, repl);
        }
        this.netIds_.register(repl.netId, e);
        this.known_.add(e);
        this.knownNetIds_.set(e, repl.netId);
        this.seedShadow_(e);
        return this.spawnPayload_(e, repl.netId);
    }

    private seedShadow_(e: Entity): void {
        const perComp = new Map<number, Record<string, unknown>>();
        for (const te of this.table.entries) {
            if (!this.world_.has(e, te.def)) continue;
            const data = this.world_.tryGet(e, te.def) as Record<string, unknown>;
            const snap: Record<string, unknown> = {};
            for (const f of te.fields) snap[f] = deepClone(data[f]);
            perComp.set(te.id, snap);
        }
        this.shadow_.set(e, perComp);
    }

    private spawnPayload_(e: Entity, netId: number): ReplSpawnEntity {
        const components = serializeEntityComponents(this.world_, e).map((c) => this.rewriteEntityRefs_(c));
        // Name/Parent are structural components serializeEntityComponents skips
        // (scene records carry them beside the component list; so does this).
        const nameComp = this.world_.tryGet(e, Name) as { value: string } | null;
        const parentComp = this.world_.tryGet(e, Parent) as { entity: number } | null;
        const parentNetId = parentComp ? (this.netIds_.netIdOf(parentComp.entity as Entity) ?? 0) : 0;
        return {
            netId,
            name: nameComp?.value ?? '',
            parentNetId,
            components,
        };
    }

    private rewriteEntityRefs_(c: SceneComponentData): SceneComponentData {
        const entityFields = getComponent(c.type)?.entityFields ?? [];
        if (entityFields.length === 0) return c;
        const data = { ...c.data };
        for (const f of entityFields) {
            if (typeof data[f] === 'number') {
                data[f] = this.netIds_.netIdOf(data[f] as Entity) ?? 0;
            }
        }
        return { type: c.type, data };
    }

    private diffEntity_(e: Entity, frame: FrameWriter): void {
        const perComp = this.shadow_.get(e);
        if (!perComp) return;
        const netId = this.netIds_.netIdOf(e);
        if (netId === undefined) return;
        for (const te of this.table.entries) {
            if (!this.world_.has(e, te.def)) continue;
            const data = this.world_.tryGet(e, te.def) as Record<string, unknown>;
            let snap = perComp.get(te.id);
            if (!snap) {
                // Component added after spawn: replicate all fields.
                snap = {};
                perComp.set(te.id, snap);
            }
            let mask = 0;
            for (let i = 0; i < te.fields.length; i++) {
                const f = te.fields[i];
                if (!(f in snap) || !fieldEqual(data[f], snap[f])) {
                    mask |= 1 << i;
                    snap[f] = deepClone(data[f]);
                }
            }
            if (mask !== 0) {
                frame.entry(netId, te, mask, data, this.refs_);
            }
        }
    }

    private sendInitialState_(conn: Connection): void {
        if (!this.connections_.has(conn.id)) return;
        // Everything known right now, full component payloads (current state
        // included — no separate baseline frame needed).
        const entities: ReplSpawnEntity[] = [];
        for (const e of this.known_) {
            const netId = this.netIds_.netIdOf(e);
            if (netId !== undefined) entities.push(this.spawnPayload_(e, netId));
        }
        if (entities.length > 0) {
            conn.channel.send<ReplSpawnBatch>(ReplMsg.spawn, { tick: this.tick_, entities });
        }
        conn.ready = true;
    }

    private broadcast_(fn: (conn: Connection) => void): void {
        for (const conn of this.connections_.values()) {
            if (!conn.ready) continue;
            try {
                fn(conn);
            } catch (err) {
                log.warn('repl', `broadcast to connection ${conn.id} failed`, err);
            }
        }
    }
}
