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
import type { InterestPolicy, InterestProvider } from './interest';

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
    /**
     * What `interest` was last PROVED from. When every part of it still holds,
     * the same source would answer the same set, so it is not asked: no query,
     * no copy of the answer, and no scan for what entered or left. Null while
     * nothing certified it — the connection is queried.
     */
    provenance: VisibilityStamp | null;
}

/**
 * The three facts one connection's visibility is a function of. Equal on all
 * three across two samples and the answer cannot have moved.
 *
 * @note `source` is here because generations are each provider's own numbering:
 *       two providers both on their fifth snapshot are not the same snapshot.
 */
interface VisibilityStamp {
    source: number;
    snapshot: number;
    owned: number;
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

/** The plan of a connection that was not asked again: nothing entered it. */
const NOBODY: ReadonlySet<Entity> = new Set<Entity>();

function sameVisibility(held: VisibilityStamp | null, now: VisibilityStamp): boolean {
    return held !== null && held.source === now.source
        && held.snapshot === now.snapshot && held.owned === now.owned;
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

    /**
     * Which connections can see an entity — the reverse projection of every
     * `conn.interest`, maintained from the enters and leaves the visibility pass
     * produces. Null with no interest source: broadcasting would rebuild, as a
     * Map, exactly the O(C x E) this exists to avoid.
     */
    private viewersByEntity_: Map<Entity, Set<number>> | null = null;
    /** known entity → netId, owned by sampling. Survives the onDespawn hook
     *  clearing netIds_, so a despawn can still broadcast its id. */
    private readonly knownNetIds_ = new Map<Entity, number>();
    /**
     * One interest slot, two shapes: a policy filters per connection, a provider
     * prepares once and answers each from it. Never both — "does the provider
     * run before the policy?" would quietly redefine what `candidates` means.
     */
    private interest_: { kind: 'policy'; value: InterestPolicy }
        | { kind: 'provider'; value: InterestProvider }
        | null = null;
    /**
     * Which source the stamps in flight belong to. Bumped by every install, so
     * a new provider whose numbering happens to land on the outgoing one's
     * cannot be mistaken for it.
     */
    private interestEpoch_ = 0;
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
    /**
     * Who owns what, so neither the anchor lookup nor the server's forced-owner
     * pass has to read every candidate to find out. Installed with the first
     * interest policy — a broadcast server never pays for it — and kept for the
     * server's life, since a policy can be swapped mid-session.
     */
    private ownedByConnection_: Map<number, Set<Entity>> | null = null;
    /** The index's own record of who owned each entity: a write says the NEW
     *  owner, and the old one is needed to take the entity off its set. */
    private readonly ownerOfEntity_ = new Map<Entity, number>();
    /** How many times a connection's owned set changed. The other half of what
     *  a spatial answer is a function of: the snapshot can stand still while
     *  the anchors a connection looks from change hands. */
    private readonly ownedEpoch_ = new Map<number, number>();
    private ownerFloor_ = -1;
    private ownerReader_: number | null = null;
    /** @internal Full-world reconciliations run — a steady-state sample must do none. */
    fullScans = 0;
    /**
     * @internal Connections whose visibility was proved again — queried, copied
     * and diffed. A sample in which no relevance input moved must do none, and
     * that is the whole claim of the stamp.
     */
    visibilityRecomputes = 0;
    /** @internal Entities entering and leaving views — what spawn serialization
     *  and the control plane are actually paid for. */
    entersSent = 0;
    leavesSent = 0;
    /** @internal Distinct entities serialized into a spawn payload this run. */
    payloadsBuilt = 0;
    /**
     * @internal Milliseconds attributed to each LEAF phase of `sample`, plus
     * `total` for the whole call. Nothing nests, so `total` minus the rest is
     * exactly what the decomposition fails to explain — a budget with a large
     * remainder has not been decomposed. Off unless `profileSample` is set.
     */
    readonly samplePhases = new Map<string, number>();
    /** @internal Turns the phase accounting on; it costs two clock reads a phase. */
    profileSample = false;

    private mark_(): number {
        return this.profileSample && typeof performance !== 'undefined' ? performance.now() : 0;
    }

    private since_(phase: string, at: number): void {
        if (!this.profileSample || typeof performance === 'undefined') return;
        this.samplePhases.set(phase, (this.samplePhases.get(phase) ?? 0) + (performance.now() - at));
    }

    /**
     * How many (entity, connection) links the reverse-interest index holds.
     * A diagnostic, and the only way to see that a detached connection or a
     * failed initial send left nothing behind — routing guards against a stale
     * link, so one costs memory and bandwidth rather than correctness.
     *
     * @internal
     */
    get viewerLinks(): number {
        let n = 0;
        for (const seen of this.viewersByEntity_?.values() ?? []) n += seen.size;
        return n;
    }
    /** @internal Candidates read to answer "who owns this" — zero once indexed. */
    ownerScanVisits = 0;

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
        if (this.ownerReader_ !== null) {
            this.world_.disposeWriteReader(Replicated, this.ownerReader_);
            this.ownerReader_ = null;
        }
        if (this.interest_?.kind === 'provider') this.interest_.value.dispose?.();
        this.interest_ = null;
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
        this.setInterest_(policy ? { kind: 'policy', value: policy } : null);
    }

    /**
     * Install a prepare-once/query-many provider. Shares the slot with
     * {@link setInterestPolicy}: the last non-null setter wins, and null on
     * either disables interest.
     *
     * @experimental
     */
    setInterestProvider(provider: InterestProvider | null): void {
        this.setInterest_(provider ? { kind: 'provider', value: provider } : null);
    }

    private setInterest_(next: typeof this.interest_): void {
        const previous = this.interest_;
        this.interestEpoch_++;
        if (previous?.kind === 'provider' && previous.value !== (next as { value?: unknown })?.value) {
            previous.value.dispose?.();
        }
        if (next && !this.ownedByConnection_) this.installOwnerIndex_();
        this.interest_ = next;
        if (!next) { this.viewersByEntity_ = null; return; }
        // Seeded from what the connections already hold: coming from broadcast,
        // `interest` is a superset of `visible`, so nothing would ever ENTER and
        // the index would stay empty while every connection watched everything.
        if (!this.viewersByEntity_) {
            this.viewersByEntity_ = new Map();
            for (const conn of this.connections_.values()) {
                for (const e of conn.interest) this.watch_(e, conn.id);
            }
        }
    }

    /** @internal One connection now sees this entity. */
    private watch_(entity: Entity, connectionId: number): void {
        const index = this.viewersByEntity_;
        if (!index) return;
        let seen = index.get(entity);
        if (!seen) { seen = new Set(); index.set(entity, seen); }
        seen.add(connectionId);
    }

    /** @internal It no longer does. */
    private unwatch_(entity: Entity, connectionId: number): void {
        const seen = this.viewersByEntity_?.get(entity);
        if (!seen) return;
        seen.delete(connectionId);
        if (seen.size === 0) this.viewersByEntity_!.delete(entity);
    }

    /** Everything a leaving connection was watching. O(its view), and a detach
     *  is not a steady-state path — twelve enters and leaves a sample are. */
    private forgetViewer_(conn: Connection): void {
        if (!this.viewersByEntity_) return;
        for (const e of conn.interest) this.unwatch_(e, conn.id);
    }

    /** Claim the write journal, then seed from what is already known — in that
     *  order, so nothing written between the two is missed. */
    private installOwnerIndex_(): void {
        this.ownerFloor_ = this.world_.getWorldTick() - 1;
        this.ownerReader_ = this.world_.registerWriteReaderFrom(Replicated, this.ownerFloor_ + 1);
        this.ownedByConnection_ = new Map();
        for (const e of this.known_) this.indexOwner_(e);
    }

    /** Put `e` under its current owner, taking it off the previous one's set. */
    private indexOwner_(e: Entity): void {
        const index = this.ownedByConnection_;
        if (!index) return;
        const repl = this.world_.tryGet(e, Replicated) as ReplicatedData | null;
        const now = repl ? repl.owner : undefined;
        const before = this.ownerOfEntity_.get(e);
        if (before === now) return;
        if (before !== undefined) {
            this.ownedByConnection_?.get(before)?.delete(e);
            this.bumpOwned_(before);
        }
        if (now === undefined) { this.ownerOfEntity_.delete(e); return; }
        let set = index.get(now);
        if (!set) { set = new Set(); index.set(now, set); }
        set.add(e);
        this.ownerOfEntity_.set(e, now);
        this.bumpOwned_(now);
    }

    /** This connection looks from somewhere else now than it did. */
    private bumpOwned_(connectionId: number): void {
        this.ownedEpoch_.set(connectionId, (this.ownedEpoch_.get(connectionId) ?? 0) + 1);
    }

    /** Drop `e` from the index entirely — it has left replication. */
    private unindexOwner_(e: Entity): void {
        const before = this.ownerOfEntity_.get(e);
        if (before === undefined) return;
        this.ownedByConnection_?.get(before)?.delete(e);
        this.ownerOfEntity_.delete(e);
        this.bumpOwned_(before);
    }

    /**
     * Refresh the index from the entities whose `Replicated` was written. Write
     * history SELECTS candidates; the index's own record against the current
     * world DECIDES — a write that did not move ownership costs one comparison.
     */
    private refreshOwnerIndex_(): void {
        if (this.ownerReader_ === null) return;
        for (const e of this.world_.getWrittenEntitiesSince(Replicated, this.ownerFloor_)) {
            if (this.known_.has(e)) this.indexOwner_(e);
        }
    }

    private advanceOwnerFloor_(): void {
        if (this.ownerReader_ === null) return;
        const nextFloor = this.world_.getWorldTick() - 1;
        this.world_.advanceWriteReader(Replicated, this.ownerReader_, nextFloor);
        this.ownerFloor_ = nextFloor;
    }

    /** Accept a transport (server-side end of one client link). */
    attachConnection(transport: ReliableOrderedTransport): number {
        const id = this.nextConnectionId_++;
        const channel = new NetChannel(transport);
        const conn: Connection = {
            id, channel, ready: false,
            input: null, queue: [], applied: null, ackedSeq: 0,
            lastSeq: 0, droppedInputs: 0,
            interest: new Set(), provenance: null,
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
        this.forgetViewer_(conn);
        conn.channel.dispose();
        this.connections_.delete(id);
        // Ids are never reused, so this is the whole lifetime of the count.
        this.ownedEpoch_.delete(id);
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
            this.advanceOwnerFloor_();
            return;
        }

        const started = this.mark_();
        let at = started;
        const { spawnedEntities, despawned } = this.reconcileRegistryIncremental_();
        this.since_('registry', at);

        // Before anything reads ownership: an owner that changed this frame must
        // place the view THIS sample, not the next one.
        at = this.mark_();
        this.refreshOwnerIndex_();
        this.since_('owner index', at);

        // Diff once against the shadow; frames below share the result.
        at = this.mark_();
        const sample = this.collectDirty_();
        this.since_('dirty discovery', at);

        if (!this.interest_) {
            this.sampleBroadcast_(tick, spawnedEntities, despawned, sample);
        } else {
            this.sampleWithInterest_(tick, spawnedEntities, despawned, sample);
        }

        // Acknowledge consumed inputs: this tick's state incorporates each
        // connection's commands through the seq its gameplay ran against.
        at = this.mark_();
        for (const conn of [...this.connections_.values()]) {
            if (!conn.ready || !conn.applied || conn.applied.seq <= conn.ackedSeq) continue;
            conn.ackedSeq = conn.applied.seq;
            this.sendTo_(conn, (c) => c.channel.send<ReplAckMsg>(ReplMsg.ack, { tick, seq: conn.ackedSeq }));
        }
        this.since_('ack', at);

        // Last: the windows are given up only once their rows are on the wire.
        at = this.mark_();
        this.advanceObservationFloor_();
        this.advanceRegistryFloor_();
        this.advanceOwnerFloor_();
        this.since_('reader floors', at);
        this.since_('total', started);
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

    /**
     * Interest path in three parts: visibility, routing, sending.
     *
     * @note Routing is separate because one of the two ways needs every
     *       connection's visibility settled first. A failed send is not rolled
     *       back — that connection is a dead participant (see sendTo_).
     */
    private sampleWithInterest_(
        tick: number,
        spawnedEntities: Entity[],
        despawned: { entity: Entity; netId: number }[],
        { dirty, removals }: DirtySample,
    ): void {
        const despawnedNetIds = new Map(despawned.map((d) => [d.entity, d.netId]));
        // One snapshot for every connection this sample: a provider prepares
        // here, and never on the per-connection path below.
        const visibility = this.resolveVisibility_({
            entered: spawnedEntities,
            left: despawned.map((d) => d.entity),
            // A component going away is not something that component's value feed
            // reports, and a provider caching a fact READ from one has to hear.
            rechecked: removals.map((r) => r.entity),
        });

        // What each connection can see, and the index that answers the reverse
        // question.
        const plans: {
            conn: Connection; visible: ReadonlySet<Entity>; enters: Entity[];
            leaveIds: number[]; entered: ReadonlySet<Entity>;
        }[] = [];
        for (const conn of [...this.connections_.values()]) {
            if (!conn.ready) continue;
            const stamp = visibility.snapshot === null ? null : {
                source: this.interestEpoch_,
                snapshot: visibility.snapshot,
                owned: this.ownedEpoch_.get(conn.id) ?? 0,
            };
            // Nothing this answer is a function of moved: no query, no copy of
            // a result, neither scan over it. Routing needs no help — the
            // reverse index is already what this connection holds.
            if (stamp && sameVisibility(conn.provenance, stamp)) {
                plans.push({
                    conn, visible: conn.interest, enters: [], leaveIds: [], entered: NOBODY,
                });
                continue;
            }
            this.visibilityRecomputes++;
            let at = this.mark_();
            const visible = visibility.visible(conn.id);
            this.since_('visibility query', at);
            at = this.mark_();
            const enters: Entity[] = [];
            for (const e of visible) {
                if (conn.interest.has(e)) continue;
                enters.push(e);
                this.watch_(e, conn.id);
            }
            const leaveIds: number[] = [];
            for (const e of conn.interest) {
                if (visible.has(e)) continue;
                this.unwatch_(e, conn.id);
                const netId = this.knownNetIds_.get(e) ?? despawnedNetIds.get(e);
                if (netId !== undefined) leaveIds.push(netId);
            }
            conn.interest = visible;
            conn.provenance = stamp;
            plans.push({ conn, visible, enters, leaveIds, entered: new Set(enters) });
            this.since_('visibility diff', at);
        }

        // Whose debt is whose.
        const routing = this.mark_();
        const routed = this.route_(plans, dirty, removals);
        this.since_('routing', routing);

        // The wire. Spawn payloads serialize once per entity per tick, however
        // many connections it enters.
        const payloads = new Map<Entity, ReplSpawnEntity>();
        const payloadOf = (e: Entity): ReplSpawnEntity => {
            let p = payloads.get(e);
            if (!p) {
                const at = this.mark_();
                p = this.spawnPayload_(e, this.knownNetIds_.get(e)!);
                this.since_('spawn payload', at);
                this.payloadsBuilt++;
                payloads.set(e, p);
            }
            return p;
        };
        for (const { conn, enters, leaveIds } of plans) {
            const mine = routed.get(conn.id)!;
            this.entersSent += enters.length;
            this.leavesSent += leaveIds.length;
            this.sendTo_(conn, (c) => {
                // Serialized before `control send` is timed: `payloadOf` has a
                // phase of its own and would otherwise be counted twice.
                const spawning = enters.length > 0 ? enters.map(payloadOf) : null;
                const control = this.mark_();
                if (spawning) {
                    c.channel.send<ReplSpawnBatch>(ReplMsg.spawn, { tick, entities: spawning });
                }
                if (leaveIds.length > 0) {
                    c.channel.send<ReplDespawnBatch>(ReplMsg.despawn, { tick, netIds: leaveIds });
                }
                if (mine.removals.length > 0) {
                    c.channel.send<ReplComponentRemoveBatch>(
                        ReplMsg.componentRemove, removeBatch(tick, mine.removals.map((i) => removals[i]!)));
                }
                this.since_('control send', control);
                if (mine.dirty.length > 0) {
                    const encoding = this.mark_();
                    const frame = new FrameWriter(tick);
                    for (const i of mine.dirty) {
                        const d = dirty[i]!;
                        frame.entry(d.netId, d.te, d.mask, d.data, this.refs_);
                    }
                    const payload = frame.entryCount > 0 ? frame.finish() : null;
                    this.since_('frame encode', encoding);
                    if (payload) {
                        const sending = this.mark_();
                        c.channel.sendBinary(REPLICATION_CHANNEL, payload);
                        this.since_('transport send', sending);
                    }
                }
            });
        }
    }

    /**
     * This sample's debt, merged per ENTITY. An entity with two dirty components
     * and a removal is one reverse lookup and one map probe, not three, and the
     * wire still carries removals before the delta.
     */
    private static byEntity(dirty: DirtyEntry[], removals: RemovalEntry[]):
    Map<Entity, { dirty: number[]; removals: number[] }> {
        const affected = new Map<Entity, { dirty: number[]; removals: number[] }>();
        const of = (e: Entity) => {
            let debt = affected.get(e);
            if (!debt) { debt = { dirty: [], removals: [] }; affected.set(e, debt); }
            return debt;
        };
        for (let i = 0; i < removals.length; i++) of(removals[i]!.entity).removals.push(i);
        for (let i = 0; i < dirty.length; i++) of(dirty[i]!.entity).dirty.push(i);
        return affected;
    }

    /**
     * Which rows each connection owes, by whichever projection of the same truth
     * is smaller THIS sample: pushing costs `U + F`, pulling `S`. No threshold.
     *
     * @note `U + F >= U`, so `U >= S` settles it without measuring F, which
     *       would cost push's dominant term to decide against push.
     */
    private route_(
        plans: { conn: Connection; visible: ReadonlySet<Entity>; entered: ReadonlySet<Entity> }[],
        dirty: DirtyEntry[],
        removals: RemovalEntry[],
    ): Map<number, { dirty: number[]; removals: number[] }> {
        const out = new Map<number, { dirty: number[]; removals: number[] }>();
        for (const { conn } of plans) out.set(conn.id, { dirty: [], removals: [] });
        if (dirty.length === 0 && removals.length === 0) return out;

        const affected = ReplicationServer.byEntity(dirty, removals);
        let membership = 0;
        for (const { visible } of plans) membership += visible.size;

        const viewers = this.viewersByEntity_;
        if (viewers && affected.size < membership) {
            const rows: [Entity, { dirty: number[]; removals: number[] }, Set<number> | undefined][] = [];
            let units = affected.size;
            for (const [e, debt] of affected) {
                const seen = viewers.get(e);
                rows.push([e, debt, seen]);
                units += seen ? seen.size : 0;
            }
            if (units < membership) {
                const entered = new Map(plans.map((p) => [p.conn.id, p.entered]));
                for (const [e, debt, seen] of rows) {
                    if (!seen) continue;
                    for (const id of seen) {
                        const mine = out.get(id);
                        // An entity that entered this sample was serialized with
                        // its current state, so it owes no delta and no removal.
                        if (!mine || entered.get(id)!.has(e)) continue;
                        for (const i of debt.removals) mine.removals.push(i);
                        for (const i of debt.dirty) mine.dirty.push(i);
                    }
                }
                // Back into the order the rows were discovered in: the frame a
                // connection receives is the same one either way, and this costs
                // only what is actually SENT.
                for (const mine of out.values()) {
                    mine.removals.sort((a, b) => a - b);
                    mine.dirty.sort((a, b) => a - b);
                }
                return out;
            }
        }

        for (const { conn, visible, entered } of plans) {
            const mine = out.get(conn.id)!;
            for (const e of visible) {
                const debt = affected.get(e);
                if (!debt || entered.has(e)) continue;
                for (const i of debt.removals) mine.removals.push(i);
                for (const i of debt.dirty) mine.dirty.push(i);
            }
            mine.removals.sort((a, b) => a - b);
            mine.dirty.sort((a, b) => a - b);
        }
        return out;
    }

    /**
     * One snapshot of the interest source, and a function answering per
     * connection from it. A provider prepares ONCE — that is the whole reason
     * it exists — and never sees a materialized candidate array, which is the
     * other O(population) the policy shape forces.
     *
     * `snapshot` is what the source says this snapshot IS, when it says
     * anything. Null means the answers below have to be asked for; a number
     * means a connection whose stamp already carries it holds the same answer.
     */
    private resolveVisibility_(membership: {
        entered: readonly Entity[];
        left: readonly Entity[];
        rechecked: readonly Entity[];
    } = { entered: [], left: [], rechecked: [] }): {
        snapshot: number | null;
        visible: (connectionId: number) => Set<Entity>;
    } {
        // Relevance is decided in world space, so the composition has to be
        // current before a snapshot is taken — here rather than inside a position
        // reader, so a caller's own reader sees the same composed fact.
        const composed = this.mark_();
        this.world_.ensureTransformsComposed();
        this.since_('composition', composed);
        const source = this.interest_;
        if (!source) {
            const all = [...this.known_];
            return { snapshot: null, visible: () => new Set(all) };
        }
        if (source.kind === 'provider') {
            const known = this.known_;
            const prepping = this.mark_();
            const prepared = source.value.prepare({
                world: this.world_,
                // A wrapper, not the registry itself: a caller that casts the
                // iterable back to a Set could otherwise clear it.
                entities: { [Symbol.iterator]: () => known.values() },
                entityCount: known.size,
                ...membership,
            });
            this.since_('interest prepare', prepping);
            return {
                snapshot: prepared.generation ?? null,
                visible: (connectionId) => {
                    const owned = this.ownedByConnection_?.get(connectionId);
                    const ownedList = owned ? [...owned] : [];
                    const result = prepared.query({ connectionId, owned: ownedList });
                    const visible = result === 'all' ? new Set(this.known_) : new Set(result);
                    for (const e of ownedList) visible.add(e);
                    return visible;
                },
            };
        }
        const candidates = [...this.known_];
        // A policy is handed the population and asked; there is nothing for it
        // to certify a repeat answer with.
        return { snapshot: null, visible: (connectionId) => this.visibleFor_(connectionId, candidates) };
    }

    /** The policy's answer for one connection, with the server's invariant
     *  applied on top: a connection always sees the entities it owns (input
     *  routing and prediction anchor on them, so a policy cannot cull them). */
    private visibleFor_(connectionId: number, candidates: readonly Entity[]): Set<Entity> {
        const owned = this.ownedByConnection_?.get(connectionId);
        const policy = this.interest_?.kind === 'policy' ? this.interest_.value : null;
        if (!policy) return new Set(candidates);
        const result = policy({
            connectionId, world: this.world_, candidates,
            owned: owned ? [...owned] : undefined,
        });
        const visible = result === 'all' ? new Set(candidates) : new Set(result);
        // The server's invariant, not the policy's: an entity a connection owns
        // is always visible to it. From the index when there is one — reading it
        // off every candidate is the same question asked a second time.
        if (owned) {
            for (const e of owned) visible.add(e);
            return visible;
        }
        for (const e of candidates) {
            this.ownerScanVisits++;
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
                this.indexOwner_(e);
                spawnedEntities.push(e);
                continue;
            }
            this.restoreNetId_(e);
            this.indexOwner_(e);
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
                this.indexOwner_(e);
                spawnedEntities.push(e);
            } else if (isKnown && !isLive) {
                this.unindexOwner_(e);
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
        this.refreshOwnerIndex_();
        this.advanceOwnerFloor_();
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
        const visible = this.resolveVisibility_().visible(conn.id);
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
        // After the send, not before: a connection that never heard about the
        // world is not a viewer of it, and the early return above is the only
        // other way out of this function.
        for (const e of visible) this.watch_(e, conn.id);
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
