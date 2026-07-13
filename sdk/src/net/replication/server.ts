// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    server.ts
 * @brief   The authoritative endpoint. Owns connections (one NetChannel per
 *          transport), answers the handshake, and each fixed tick: replicates
 *          spawns/despawns of `Replicated` entities on the JSON control plane
 *          and diffs replicated fields against a shadow copy into binary delta
 *          frames. WebSocket transports are reliable+ordered, so
 *          delta-since-last-send needs no ack protocol.
 *
 *          With an {@link InterestPolicy} installed, spawns/despawns/deltas are
 *          filtered per connection: the shadow diff still runs once, but each
 *          connection only receives the entities the policy deems relevant,
 *          entering entities arrive as full spawns and leaving ones as
 *          despawns. Without a policy every ready connection sees everything
 *          on a single broadcast frame (the fast path).
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
    type ReplAckMsg, type ReplDespawnBatch, type ReplHelloRequest, type ReplHelloResponse,
    type ReplInputMsg, type ReplSpawnBatch, type ReplSpawnEntity,
} from './protocol';
import {
    buildReplicationTable, cloneValue, diffSchemas, tableSchemas, FrameWriter,
    type EntityRefMap, type ReplicationTable, type ReplicationTableEntry,
} from './codec';
import { Replicated, type ReplicatedData } from './components';
import { NetIds } from './NetIds';
import type { InterestPolicy } from './interest';

interface Connection {
    id: number;
    channel: NetChannel;
    /** Handshake completed and the initial world spawn has been sent. */
    ready: boolean;
    /** Latest input command from this connection (stale seq never overwrites). */
    input: ReplInputMsg | null;
    /** Queued input commands, consumed exactly one per fixed tick (beginTick). */
    queue: ReplInputMsg[];
    /** The command this tick's gameplay runs against (repeats on starvation). */
    applied: ReplInputMsg | null;
    /** Highest input seq acknowledged to the client (0 = none yet). */
    ackedSeq: number;
    /** Entities this connection currently knows (has been sent a spawn for). */
    interest: Set<Entity>;
}

/** Queued-but-unconsumed input cap; beyond it the oldest commands drop (a
 *  client flooding faster than the tick rate loses history, not the server). */
const INPUT_QUEUE_CAP = 128;

/** One dirty component on one entity this tick — diffed once, written into
 *  whichever frames (shared or per-connection) need it. `data` is the live
 *  component record; it is read before the next simulation step mutates it. */
interface DirtyEntry {
    entity: Entity;
    netId: number;
    te: ReplicationTableEntry;
    mask: number;
    data: Record<string, unknown>;
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
    private policy_: InterestPolicy | null = null;
    private tick_ = 0;
    private fixedDelta_ = 0;

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

    /**
     * Install (or replace / remove) the interest policy. With a policy, each
     * ready connection only receives the entities the policy deems relevant to
     * it; an entity entering a connection's interest arrives as a full spawn,
     * one leaving despawns its client ghost. Entities a connection owns are
     * always relevant to it regardless of the policy. Safe to change
     * mid-session: the next sample tick reconciles every connection's ghost
     * set against the new policy.
     */
    setInterestPolicy(policy: InterestPolicy | null): void {
        this.policy_ = policy;
    }

    /** Accept a transport (server-side end of one client link). */
    attachConnection(transport: NetTransport): number {
        const id = this.nextConnectionId_++;
        const channel = new NetChannel(transport);
        const conn: Connection = {
            id, channel, ready: false,
            input: null, queue: [], applied: null, ackedSeq: 0,
            interest: new Set(),
        };
        this.connections_.set(id, conn);

        channel.on<ReplInputMsg>(ReplMsg.input, (msg) => {
            if (!conn.input || msg.seq > conn.input.seq) conn.input = msg;
            // The per-tick queue keeps every command in order for exactly-once
            // consumption (tickInputOf) — the contract prediction replays against.
            conn.queue.push(msg);
            if (conn.queue.length > INPUT_QUEUE_CAP) conn.queue.shift();
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
            return { ok: true, connectionId: id, tick: this.tick_, fixedDelta: this.fixedDelta_ };
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
     *  connection owns (Replicated.owner). Latest-persists: a held command
     *  applies every tick until replaced. */
    inputOf(connectionId: number): ReplInputMsg | null {
        return this.connections_.get(connectionId)?.input ?? null;
    }

    /**
     * The input command dequeued for THIS fixed tick — each command is
     * consumed exactly once, in order, one per tick ({@link beginTick}); when
     * the queue runs dry the last command repeats (network jitter must not
     * stall a held input). This is the accessor prediction-grade gameplay
     * applies in FixedUpdate: the server acknowledges the consumed seq, and
     * the client replays exactly the unacknowledged commands, one tick each.
     */
    tickInputOf(connectionId: number): ReplInputMsg | null {
        return this.connections_.get(connectionId)?.applied ?? null;
    }

    /**
     * Start a fixed tick: dequeue each connection's next input command (the
     * plugin calls this in FixedPreUpdate, before gameplay). `fixedDelta` is
     * remembered for the handshake so clients replay with the server's dt.
     */
    beginTick(fixedDelta: number): void {
        if (fixedDelta > 0) this.fixedDelta_ = fixedDelta;
        for (const conn of this.connections_.values()) {
            const next = conn.queue.shift();
            if (next) conn.applied = next;
        }
    }

    /** One replication tick: spawns/despawns on the control plane, dirty
     *  fields as binary delta frames (one shared broadcast without a policy,
     *  one filtered frame per connection with one). Runs in FixedPostUpdate. */
    sample(tick: number): void {
        this.tick_ = tick;
        if (this.connections_.size === 0) return;

        const current = this.world_.getEntitiesWithComponents([Replicated]);
        const currentSet = new Set(current);

        const spawnedEntities: Entity[] = [];
        for (const e of current) {
            if (!this.known_.has(e)) {
                this.registerEntity_(e);
                spawnedEntities.push(e);
            }
        }

        // netIds captured before unregistering so per-connection despawns can
        // still name entities that vanished this tick.
        const despawned: { entity: Entity; netId: number }[] = [];
        for (const e of [...this.known_]) {
            if (!currentSet.has(e) || !this.world_.valid(e)) {
                const netId = this.knownNetIds_.get(e);
                if (netId !== undefined) {
                    despawned.push({ entity: e, netId });
                    this.netIds_.unregister(netId);
                }
                this.known_.delete(e);
                this.knownNetIds_.delete(e);
                this.shadow_.delete(e);
            }
        }

        // Diff once against the shadow; frames below share the result.
        const dirty = this.collectDirty_();

        if (!this.policy_) {
            this.sampleBroadcast_(tick, spawnedEntities, despawned, dirty);
        } else {
            this.sampleWithInterest_(tick, despawned, dirty);
        }

        // Acknowledge consumed inputs: this tick's state incorporates each
        // connection's commands through the seq its gameplay ran against.
        for (const conn of this.connections_.values()) {
            if (!conn.ready || !conn.applied || conn.applied.seq <= conn.ackedSeq) continue;
            conn.ackedSeq = conn.applied.seq;
            this.sendTo_(conn, (c) => c.channel.send<ReplAckMsg>(ReplMsg.ack, { tick, seq: conn.ackedSeq }));
        }
    }

    /** Fast path (no policy): everything to every ready connection on shared
     *  payloads. Interest bookkeeping stays exact so a policy can be installed
     *  (or removed) mid-session and the next tick reconciles cleanly. */
    private sampleBroadcast_(
        tick: number,
        spawnedEntities: Entity[],
        despawned: { entity: Entity; netId: number }[],
        dirty: DirtyEntry[],
    ): void {
        if (spawnedEntities.length > 0) {
            const entities = spawnedEntities.map((e) => this.spawnPayload_(e, this.knownNetIds_.get(e)!));
            this.broadcast_((c) => c.channel.send<ReplSpawnBatch>(ReplMsg.spawn, { tick, entities }));
        }
        if (despawned.length > 0) {
            const netIds = despawned.map((d) => d.netId);
            this.broadcast_((c) => c.channel.send<ReplDespawnBatch>(ReplMsg.despawn, { tick, netIds }));
        }

        for (const conn of this.connections_.values()) {
            if (!conn.ready) continue;
            for (const e of spawnedEntities) conn.interest.add(e);
            for (const d of despawned) conn.interest.delete(d.entity);
            // A policy removed mid-session may have left this connection blind
            // to entities it never entered — catch it up (interest ⊆ known, so
            // equal sizes ⇒ equal sets and this costs one comparison).
            if (conn.interest.size !== this.known_.size) {
                const missing: ReplSpawnEntity[] = [];
                for (const e of this.known_) {
                    if (conn.interest.has(e)) continue;
                    conn.interest.add(e);
                    missing.push(this.spawnPayload_(e, this.knownNetIds_.get(e)!));
                }
                if (missing.length > 0) {
                    this.sendTo_(conn, (c) => c.channel.send<ReplSpawnBatch>(ReplMsg.spawn, { tick, entities: missing }));
                }
            }
        }

        if (dirty.length > 0) {
            const frame = new FrameWriter(tick);
            for (const d of dirty) frame.entry(d.netId, d.te, d.mask, d.data, this.refs_);
            const payload = frame.finish();
            this.broadcast_((c) => c.channel.sendBinary(REPLICATION_CHANNEL, payload));
        }
    }

    /** Interest path: evaluate the policy per ready connection; spawn entering
     *  entities (full current state), despawn leaving ones, and write that
     *  connection's delta frame from the shared dirty list. */
    private sampleWithInterest_(
        tick: number,
        despawned: { entity: Entity; netId: number }[],
        dirty: DirtyEntry[],
    ): void {
        const despawnedNetIds = new Map(despawned.map((d) => [d.entity, d.netId]));
        const candidates = [...this.known_];
        // Spawn payloads serialize once per entity per tick, however many
        // connections it enters.
        const payloads = new Map<Entity, ReplSpawnEntity>();
        const payloadOf = (e: Entity): ReplSpawnEntity => {
            let p = payloads.get(e);
            if (!p) {
                p = this.spawnPayload_(e, this.knownNetIds_.get(e)!);
                payloads.set(e, p);
            }
            return p;
        };

        for (const conn of this.connections_.values()) {
            if (!conn.ready) continue;
            const visible = this.visibleFor_(conn.id, candidates);

            const enters: Entity[] = [];
            for (const e of visible) {
                if (!conn.interest.has(e)) enters.push(e);
            }
            const leaveIds: number[] = [];
            for (const e of conn.interest) {
                if (visible.has(e)) continue;
                const netId = this.knownNetIds_.get(e) ?? despawnedNetIds.get(e);
                if (netId !== undefined) leaveIds.push(netId);
            }
            conn.interest = visible;

            this.sendTo_(conn, (c) => {
                if (enters.length > 0) {
                    c.channel.send<ReplSpawnBatch>(ReplMsg.spawn, { tick, entities: enters.map(payloadOf) });
                }
                if (leaveIds.length > 0) {
                    c.channel.send<ReplDespawnBatch>(ReplMsg.despawn, { tick, netIds: leaveIds });
                }
                // Entities that just entered skip the delta — their spawn
                // payload already carries this tick's state.
                let frame: FrameWriter | null = null;
                const entered = new Set(enters);
                for (const d of dirty) {
                    if (!visible.has(d.entity) || entered.has(d.entity)) continue;
                    frame ??= new FrameWriter(tick);
                    frame.entry(d.netId, d.te, d.mask, d.data, this.refs_);
                }
                if (frame && frame.entryCount > 0) {
                    c.channel.sendBinary(REPLICATION_CHANNEL, frame.finish());
                }
            });
        }
    }

    /** The policy's answer for one connection, with the server's invariant
     *  applied on top: a connection always sees the entities it owns (input
     *  routing and prediction anchor on them, so a policy cannot cull them). */
    private visibleFor_(connectionId: number, candidates: readonly Entity[]): Set<Entity> {
        const result = this.policy_!({ connectionId, world: this.world_, candidates });
        const visible = result === 'all' ? new Set(candidates) : new Set(result);
        for (const e of candidates) {
            if (visible.has(e)) continue;
            const repl = this.world_.tryGet(e, Replicated) as ReplicatedData | null;
            if (repl && repl.owner === connectionId) visible.add(e);
        }
        return visible;
    }

    private registerEntity_(e: Entity): void {
        const repl = this.world_.tryGet(e, Replicated) as ReplicatedData;
        if (repl.netId === 0) {
            repl.netId = this.netIds_.allocate();
            this.world_.set(e, Replicated, repl);
        }
        this.netIds_.register(repl.netId, e);
        this.known_.add(e);
        this.knownNetIds_.set(e, repl.netId);
        this.seedShadow_(e);
    }

    private seedShadow_(e: Entity): void {
        const perComp = new Map<number, Record<string, unknown>>();
        for (const te of this.table.entries) {
            if (!this.world_.has(e, te.def)) continue;
            const data = this.world_.tryGet(e, te.def) as Record<string, unknown>;
            const snap: Record<string, unknown> = {};
            for (const f of te.fields) snap[f] = cloneValue(data[f]);
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

    /** Diff every known entity against its shadow (updating the shadow), and
     *  return this tick's dirty component entries. */
    private collectDirty_(): DirtyEntry[] {
        const out: DirtyEntry[] = [];
        for (const e of this.known_) {
            const perComp = this.shadow_.get(e);
            if (!perComp) continue;
            const netId = this.knownNetIds_.get(e);
            if (netId === undefined) continue;
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
                        snap[f] = cloneValue(data[f]);
                    }
                }
                if (mask !== 0) {
                    out.push({ entity: e, netId, te, mask, data });
                }
            }
        }
        return out;
    }

    private sendInitialState_(conn: Connection): void {
        if (!this.connections_.has(conn.id)) return;
        // Everything relevant right now, full component payloads (current state
        // included — no separate baseline frame needed).
        const candidates = [...this.known_];
        const visible = this.policy_ ? this.visibleFor_(conn.id, candidates) : new Set(candidates);
        const entities: ReplSpawnEntity[] = [];
        for (const e of visible) {
            const netId = this.knownNetIds_.get(e);
            if (netId !== undefined) entities.push(this.spawnPayload_(e, netId));
        }
        if (entities.length > 0) {
            conn.channel.send<ReplSpawnBatch>(ReplMsg.spawn, { tick: this.tick_, entities });
        }
        conn.interest = visible;
        conn.ready = true;
    }

    private broadcast_(fn: (conn: Connection) => void): void {
        for (const conn of this.connections_.values()) {
            if (!conn.ready) continue;
            this.sendTo_(conn, fn);
        }
    }

    private sendTo_(conn: Connection, fn: (conn: Connection) => void): void {
        try {
            fn(conn);
        } catch (err) {
            log.warn('repl', `send to connection ${conn.id} failed`, err);
        }
    }
}
