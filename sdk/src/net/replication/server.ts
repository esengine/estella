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
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Name, Parent, getComponent, type AnyComponentDef } from '../../ecs/component';
import { ABI_LAYOUT_HASH } from '../../ecs/component.generated';
import { serializeEntityComponents, type SceneComponentData } from '../../scene/scene';
import { NetChannel, type ReliableOrderedTransport } from '../NetChannel';
import { log } from '../../util/logger';
import {
    REPLICATION_CHANNEL, REPLICATION_PROTOCOL_VERSION, ReplMsg,
    type ReplAckMsg, type ReplDespawnBatch, type ReplHelloRequest, type ReplHelloResponse,
    type ReplInputMsg, type ReplSpawnBatch, type ReplSpawnEntity,
    type ReplComponentRemoveBatch,
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
    /** Highest input seq ACCEPTED from the client. Anything at or below it is a
     *  repeat or a rewind and never reaches the queue. */
    lastSeq: number;
    /** Input commands refused (repeat, rewind, or a full queue). Non-zero means
     *  this connection's prediction is replaying against a history the
     *  authority did not run. */
    droppedInputs: number;
    /** Entities this connection currently knows (has been sent a spawn for). */
    interest: Set<Entity>;
}

/** Queued-but-unconsumed input cap. Beyond it the NEW command is refused, not
 *  the oldest dropped: the queue is drained one per tick from the front, so
 *  shifting the front skips a command the client already predicted. Refusing
 *  the tail only denies credit to a client 128 ticks ahead of the authority. */
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

/** One replicated component that LEFT an entity that is still replicated.
 *  Topology, not values — it rides the control plane beside spawn/despawn. */
interface RemovalEntry {
    entity: Entity;
    netId: number;
    componentId: number;
}

/** What one sample tick found: values that moved, and components that left. */
interface DirtySample {
    dirty: DirtyEntry[];
    removals: RemovalEntry[];
}

/** Group removals into the wire batch, one entry per entity. */
function removeBatch(tick: number, removals: readonly RemovalEntry[]): ReplComponentRemoveBatch {
    const byNetId = new Map<number, number[]>();
    for (const r of removals) {
        const ids = byNetId.get(r.netId);
        if (ids) ids.push(r.componentId);
        else byNetId.set(r.netId, [r.componentId]);
    }
    return { tick, entries: [...byNetId].map(([netId, componentIds]) => ({ netId, componentIds })) };
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
    /** Removal-history claims, one per replicated component. */
    private readonly observations_: { def: AnyComponentDef; readerId: number }[] = [];
    /**
     * The floor every observation reads from, one tick BEHIND the world.
     * `worldTick` moves once per App frame while a frame may run several fixed
     * steps, and a write after a sample carries the tick it just closed — a
     * floor at the current tick drops both. The shadow filters the overlap.
     */
    private changeFloor_ = -1;
    private readonly offDespawn_: () => void;
    private disposed_ = false;
    /**
     * The registry's own window and claim. Separate from `changeFloor_` on
     * purpose: field observation installs with the LAZY table, this one watches
     * the fixed `Replicated` marker and lives as long as the server does.
     */
    private registryFloor_: number;
    private readonly registryReader_: number;
    /** @internal Full-world reconciliations run — a steady-state sample must do none. */
    fullScans = 0;

    constructor(world: World) {
        this.world_ = world;
        this.offDespawn_ = world.onDespawn((e) => {
            // Sampling handles replicated despawns; this catches direct holes.
            this.netIds_.unregisterEntity(e);
        });
        this.registryFloor_ = world.getWorldTick() - 1;
        this.registryReader_ = world.registerTopologyReaderFrom(Replicated, this.registryFloor_ + 1);
    }

    /** Lazily built so components defined after plugin install still count. */
    get table(): ReplicationTable {
        if (!this.table_) {
            const table = buildReplicationTable();
            // Installed HERE, with the table: doing it in the constructor would
            // freeze the table before the game's own components exist, and the
            // observation set would then describe a smaller world than the table.
            this.installObservation_(table);
            this.table_ = table;
        }
        return this.table_;
    }

    /** Track every replicated component, and claim its removal history. */
    private installObservation_(table: ReplicationTable): void {
        this.changeFloor_ = this.world_.getWorldTick() - 1;
        for (const te of table.entries) {
            this.world_.enableChangeTracking(te.def);
            // The query is `tick > changeFloor_`, so the claim starts one after.
            const readerId = this.world_.registerRemovedReaderFrom(te.def, this.changeFloor_ + 1);
            this.observations_.push({ def: te.def, readerId });
        }
    }

    /**
     * Close the window this sample read, and open the next one. Retention is
     * given up only after the rows were consumed — the same order a system's
     * `Removed` reader releases in.
     */
    private advanceObservationFloor_(): void {
        const nextFloor = this.world_.getWorldTick() - 1;
        for (const o of this.observations_) {
            this.world_.advanceRemovedReader(o.def, o.readerId, nextFloor);
        }
        this.changeFloor_ = nextFloor;
    }

    /** The registry's window, closed the same way and at the same moment. Two
     *  functions rather than one: the two lifecycles have already diverged once. */
    private advanceRegistryFloor_(): void {
        const nextFloor = this.world_.getWorldTick() - 1;
        this.world_.advanceTopologyReader(Replicated, this.registryReader_, nextFloor);
        this.registryFloor_ = nextFloor;
    }

    /**
     * Give back everything this server holds outside itself: its channels, its
     * claims on removal history, and its despawn subscription. Idempotent — the
     * world would otherwise keep a dead server reachable, and its claims would
     * pin removal rows for a session nobody is running.
     */
    dispose(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        for (const id of [...this.connections_.keys()]) this.detachConnection(id);
        for (const o of this.observations_) this.world_.disposeRemovedReader(o.def, o.readerId);
        this.observations_.length = 0;
        this.world_.disposeTopologyReader(Replicated, this.registryReader_);
        this.offDespawn_();
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
    attachConnection(transport: ReliableOrderedTransport): number {
        const id = this.nextConnectionId_++;
        const channel = new NetChannel(transport);
        const conn: Connection = {
            id, channel, ready: false,
            input: null, queue: [], applied: null, ackedSeq: 0,
            lastSeq: 0, droppedInputs: 0,
            interest: new Set(),
        };
        this.connections_.set(id, conn);

        channel.on<ReplInputMsg>(ReplMsg.input, (msg) => {
            // Exactly-once starts here: a repeat or a rewind must not enter the
            // queue tickInputOf drains. Running one command twice moves the
            // authority somewhere the client never predicted.
            if (typeof msg?.seq !== 'number' || msg.seq <= conn.lastSeq) {
                this.refuseInput_(conn);
                return;
            }
            conn.lastSeq = msg.seq;
            conn.input = msg;
            if (conn.queue.length >= INPUT_QUEUE_CAP) {
                this.refuseInput_(conn);
                return;
            }
            conn.queue.push(msg);
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

    /** Count a refused command, and say so the first time — a drop that only a
     *  counter knows about reads exactly like a healthy connection. */
    private refuseInput_(conn: Connection): void {
        conn.droppedInputs++;
        if (conn.droppedInputs === 1) {
            log.warn('repl', `connection ${conn.id}: input refused (repeat, rewind, or queue full) — its prediction will reconcile`);
        }
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
        for (const conn of [...this.connections_.values()]) {
            const next = conn.queue.shift();
            if (next) conn.applied = next;
        }
    }

    /** One replication tick: spawns/despawns on the control plane, dirty
     *  fields as binary delta frames (one shared broadcast without a policy,
     *  one filtered frame per connection with one). Runs in FixedPostUpdate. */
    sample(tick: number): void {
        this.tick_ = tick;
        if (this.connections_.size === 0) {
            // No world scan, but the claims still move: a reader parked on an old
            // floor pins history for as long as the server runs empty.
            this.advanceObservationFloor_();
            this.advanceRegistryFloor_();
            return;
        }

        const { spawnedEntities, despawned } = this.reconcileRegistryIncremental_();

        // Diff once against the shadow; frames below share the result.
        const sample = this.collectDirty_();

        if (!this.policy_) {
            this.sampleBroadcast_(tick, spawnedEntities, despawned, sample);
        } else {
            this.sampleWithInterest_(tick, despawned, sample);
        }

        // Acknowledge consumed inputs: this tick's state incorporates each
        // connection's commands through the seq its gameplay ran against.
        for (const conn of [...this.connections_.values()]) {
            if (!conn.ready || !conn.applied || conn.applied.seq <= conn.ackedSeq) continue;
            conn.ackedSeq = conn.applied.seq;
            this.sendTo_(conn, (c) => c.channel.send<ReplAckMsg>(ReplMsg.ack, { tick, seq: conn.ackedSeq }));
        }

        // Last: the windows are given up only once their rows are on the wire.
        this.advanceObservationFloor_();
        this.advanceRegistryFloor_();
    }

    /** Fast path (no policy): everything to every ready connection on shared
     *  payloads. Interest bookkeeping stays exact so a policy can be installed
     *  (or removed) mid-session and the next tick reconciles cleanly. */
    private sampleBroadcast_(
        tick: number,
        spawnedEntities: Entity[],
        despawned: { entity: Entity; netId: number }[],
        { dirty, removals }: DirtySample,
    ): void {
        if (spawnedEntities.length > 0) {
            const entities = spawnedEntities.map((e) => this.spawnPayload_(e, this.knownNetIds_.get(e)!));
            this.broadcast_((c) => c.channel.send<ReplSpawnBatch>(ReplMsg.spawn, { tick, entities }));
        }
        if (despawned.length > 0) {
            const netIds = despawned.map((d) => d.netId);
            this.broadcast_((c) => c.channel.send<ReplDespawnBatch>(ReplMsg.despawn, { tick, netIds }));
        }

        for (const conn of [...this.connections_.values()]) {
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

        // After the spawns (an entity that just entered carries a payload that
        // already lacks the component) and before the delta frame.
        if (removals.length > 0) {
            const batch = removeBatch(tick, removals);
            this.broadcast_((c) => c.channel.send<ReplComponentRemoveBatch>(ReplMsg.componentRemove, batch));
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
        { dirty, removals }: DirtySample,
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

        for (const conn of [...this.connections_.values()]) {
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
                const entered = new Set(enters);
                // Same rule as the delta below: an entity that just entered was
                // serialized without the component, so it owes no removal.
                const mine = removals.filter((r) => visible.has(r.entity) && !entered.has(r.entity));
                if (mine.length > 0) {
                    c.channel.send<ReplComponentRemoveBatch>(ReplMsg.componentRemove, removeBatch(tick, mine));
                }
                // Entities that just entered skip the delta — their spawn
                // payload already carries this tick's state.
                let frame: FrameWriter | null = null;
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

    /**
     * The registry rebuilt against the whole world — a baseline, not a steady
     * state. A reconciliation, not a reconstruction: entities still present keep
     * the netId the clients hold. netIds are captured before unregistering so a
     * per-connection despawn can still name what vanished this tick.
     */
    private reconcileRegistryFromWorld_(): {
        spawnedEntities: Entity[];
        despawned: { entity: Entity; netId: number }[];
    } {
        this.fullScans++;
        const current = this.world_.getEntitiesWithComponents([Replicated]);
        const currentSet = new Set(current);

        const spawnedEntities: Entity[] = [];
        for (const e of current) {
            if (!this.known_.has(e)) {
                this.registerEntity_(e);
                spawnedEntities.push(e);
                continue;
            }
            this.restoreNetId_(e);
        }

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
        return { spawnedEntities, despawned };
    }

    /**
     * Which entities entered or left replication. Topology history SELECTS
     * candidates; `known × current world` DECIDES: added-and-removed before the
     * sample is one candidate that is neither known nor live, removed-and-re-added
     * is one that is both, and the clients hear about neither.
     */
    private reconcileRegistryIncremental_(): {
        spawnedEntities: Entity[];
        despawned: { entity: Entity; netId: number }[];
    } {
        const spawnedEntities: Entity[] = [];
        const despawned: { entity: Entity; netId: number }[] = [];
        const candidates = new Set(
            this.world_.getTopologyChangedEntitiesSince(Replicated, this.registryFloor_),
        );
        for (const e of candidates) {
            const isKnown = this.known_.has(e);
            const isLive = this.world_.valid(e) && this.world_.has(e, Replicated);
            if (!isKnown && isLive) {
                this.registerEntity_(e);
                spawnedEntities.push(e);
            } else if (isKnown && !isLive) {
                const netId = this.knownNetIds_.get(e);
                if (netId !== undefined) {
                    despawned.push({ entity: e, netId });
                    this.netIds_.unregister(netId);
                }
                this.known_.delete(e);
                this.knownNetIds_.delete(e);
                this.shadow_.delete(e);
            } else if (isKnown && isLive) {
                this.restoreNetId_(e);
            }
        }
        return { spawnedEntities, despawned };
    }

    /**
     * The registry, rebuilt from the world for a client arriving when nothing is
     * ready. `sample` returns early with no connections, so the registry stops
     * following the world — and the initial state is built FROM it. Shadows are
     * re-seeded so the frame after does not re-send what the spawn carried.
     */
    private rebaseRegistry_(): void {
        this.reconcileRegistryFromWorld_();
        for (const e of this.known_) this.seedShadow_(e);
        // The shadow is now the world, so both windows start here too.
        this.advanceObservationFloor_();
        this.advanceRegistryFloor_();
    }

    /**
     * The identity the clients still hold, put back after a re-add blanked it:
     * `Replicated.netId` defaults to 0, and an entity that lost and regained the
     * component inside one window was never seen to leave. Only that blank
     * default is restored; a netId written deliberately is an open question.
     */
    private restoreNetId_(e: Entity): void {
        const held = this.knownNetIds_.get(e);
        if (held === undefined) return;
        const repl = this.world_.tryGet(e, Replicated) as ReplicatedData | null;
        if (!repl || repl.netId !== 0) return;
        this.world_.update(e, Replicated, (r) => { (r as ReplicatedData).netId = held; });
        this.netIds_.register(held, e);
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
    /**
     * What to put on the wire this sample. History SELECTS candidates; shadow ×
     * current world DECIDES truth — a component removed and re-added between
     * samples is one candidate whose shadow and world both hold it, so it
     * reduces to a field diff, or to nothing if the value came back the same.
     */
    private collectDirty_(): DirtySample {
        const out: DirtyEntry[] = [];
        const removals: RemovalEntry[] = [];
        const floor = this.changeFloor_;
        for (const te of this.table.entries) {
            const candidates = new Set<Entity>();
            // O(1) gate first: with nothing changed this component is skipped
            // without walking the population at all.
            if (this.world_.anyChangedSince(te.def, floor)) {
                for (const e of this.known_) {
                    if (this.world_.isChangedSince(e, te.def, floor)) candidates.add(e);
                }
            }
            // A Set, so a component lost twice in one window is one candidate.
            for (const e of this.world_.getRemovedEntitiesSince(te.def, floor)) candidates.add(e);

            for (const e of candidates) {
                const perComp = this.shadow_.get(e);
                if (!perComp) continue;
                const netId = this.knownNetIds_.get(e);
                if (netId === undefined) continue;
                const held = perComp.get(te.id);
                if (!this.world_.has(e, te.def)) {
                    // The shadow is the record of what the clients were told
                    // exists. Its snapshot disappearing IS the removal — there
                    // is no other trace, since a gone component is never sampled.
                    if (perComp.delete(te.id)) removals.push({ entity: e, netId, componentId: te.id });
                    continue;
                }
                const data = this.world_.tryGet(e, te.def) as Record<string, unknown>;
                // Absent from the shadow means the client has never been told it
                // exists, whether it arrived now or came back: send every field.
                const snap = held ?? {};
                if (!held) perComp.set(te.id, snap);
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
        return { dirty: out, removals };
    }

    private sendInitialState_(conn: Connection): void {
        if (!this.connections_.has(conn.id)) return;
        let anyReady = false;
        for (const c of this.connections_.values()) if (c.ready) { anyReady = true; break; }
        if (!anyReady) this.rebaseRegistry_();
        // Everything relevant right now, full component payloads (current state
        // included — no separate baseline frame needed).
        const candidates = [...this.known_];
        const visible = this.policy_ ? this.visibleFor_(conn.id, candidates) : new Set(candidates);
        const entities: ReplSpawnEntity[] = [];
        for (const e of visible) {
            const netId = this.knownNetIds_.get(e);
            if (netId !== undefined) entities.push(this.spawnPayload_(e, netId));
        }
        if (entities.length > 0
            && !this.sendTo_(conn, (c) => c.channel.send<ReplSpawnBatch>(
                ReplMsg.spawn, { tick: this.tick_, entities }))) {
            // Never told the world, so never a participant in the next delta.
            return;
        }
        conn.interest = visible;
        conn.ready = true;
    }

    private broadcast_(fn: (conn: Connection) => void): void {
        for (const conn of [...this.connections_.values()]) {
            if (!conn.ready) continue;
            this.sendTo_(conn, fn);
        }
    }

    /**
     * Hand one frame to a connection, dropping the connection if it refuses.
     * There is ONE server-global shadow and no replay log, so a connection that
     * misses an authoritative frame can never be brought back into step — the
     * next sample diffs S1→S2 against a client still holding S0.
     */
    private sendTo_(conn: Connection, fn: (conn: Connection) => void): boolean {
        try {
            fn(conn);
            return true;
        } catch (err) {
            log.warn('repl', `connection ${conn.id} could not be sent to; detaching it`, err);
            this.detachConnection(conn.id);
            return false;
        }
    }
}
