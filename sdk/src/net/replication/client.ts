// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    client.ts
 * @brief   The replica endpoint. Handshakes schema + ABI, spawns NetGhost
 *          proxies from server spawn batches (via loadComponent, so codecs and
 *          validation are the scene-loading ones), and queues binary delta
 *          frames to apply at the FixedPreUpdate boundary — state lands at a
 *          deterministic point in the frame, not mid-schedule on socket
 *          timing.
 *
 *          With {@link PredictionOptions} enabled, the entities this connection
 *          owns are simulated locally: `sendInput` applies the command to them
 *          immediately (zero perceived latency) and keeps it in a pending
 *          buffer; authoritative state for owned entities lands in a shadow
 *          "authority copy" instead of the live components; each fixed tick the
 *          live state is rebuilt as authority ⊕ replay of the unacknowledged
 *          commands (one server tick each — the server consumes the input
 *          queue at the same cadence, see `tickInputOf`). Mispredictions can
 *          therefore never accumulate: every field snaps back to the last
 *          authoritative value before the replay. Owned entities bypass
 *          snapshot interpolation entirely.
 */
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { getComponent } from '../../ecs/component';
import { ABI_LAYOUT_HASH } from '../../ecs/component.generated';
import { loadComponent } from '../../scene/scene';
import { NetChannel, type NetTransport } from '../NetChannel';
import { log } from '../../util/logger';
import {
    REPLICATION_CHANNEL, REPLICATION_PROTOCOL_VERSION, ReplMsg,
    type ReplAckMsg, type ReplDespawnBatch, type ReplHelloRequest, type ReplHelloResponse,
    type ReplInputMsg, type ReplSpawnBatch, type ReplSpawnEntity,
} from './protocol';
import {
    buildReplicationTable, cloneValue, decodeStateFrame, tableSchemas,
    type EntityRefMap, type FieldShape, type ReplicationTable, type ReplicationTableEntry, type StateFrame,
} from './codec';
import { NetGhost, Replicated, type ReplicatedData } from './components';
import { NetIds } from './NetIds';
import { InterpolationState } from './interpolation';

/**
 * Client-side prediction for owned entities. `apply` is the same input-to-
 * state logic the server's gameplay runs (register one function, use it on
 * both ends — the single source of the movement rules); with it enabled,
 * `sendInput` also applies the command locally and unacknowledged commands
 * replay on top of every authoritative update.
 */
export interface PredictionOptions {
    /** Advance one owned entity by one fixed tick of `actions`. Must depend
     *  only on world state + actions + dt (it re-runs during reconciliation). */
    apply: (world: World, entity: Entity, actions: Record<string, unknown>, dt: number) => void;
    /** Cap on unacknowledged commands kept for replay (default 120). */
    maxPendingInputs?: number;
    /**
     * Ease reconciliation corrections out instead of hard-snapping: the
     * numeric fields of owned entities keep a decaying visual error toward
     * their pre-correction value. Purely presentational — the simulation
     * rebuilds from the authority copy every tick regardless, so the error can
     * never accumulate. Off by default (corrections snap).
     */
    smoothing?: PredictionSmoothing;
}

export interface PredictionSmoothing {
    /** Seconds for the visual error to halve (typical: 0.05–0.15). */
    halfLife: number;
    /**
     * Corrections larger than this (per numeric component) snap immediately —
     * a teleport must look like a teleport. Default: no limit.
     */
    maxError?: number;
}

/** next + decayed (prev − next) over the numeric parts of a replicated field —
 *  shape-driven (the codec's FieldShape is the single source of what's numeric). */
function smoothValue(shape: FieldShape, prev: unknown, next: unknown, keep: number, maxError: number): unknown {
    if (shape.kind === 'f32') {
        if (typeof prev !== 'number' || typeof next !== 'number') return next;
        const err = prev - next;
        if (Math.abs(err) > maxError) return next;
        return next + err * keep;
    }
    if (shape.kind === 'object') {
        if (prev === null || next === null || typeof prev !== 'object' || typeof next !== 'object') return next;
        const out: Record<string, unknown> = { ...(next as Record<string, unknown>) };
        for (let i = 0; i < shape.keys.length; i++) {
            const k = shape.keys[i];
            out[k] = smoothValue(
                shape.shapes[i],
                (prev as Record<string, unknown>)[k],
                (next as Record<string, unknown>)[k],
                keep, maxError,
            );
        }
        return out;
    }
    return next;
}

export interface ReplicationClientOptions {
    /**
     * How many server ticks the presented state trails the newest received
     * data. Two ticks absorbs one lost/late delivery without a visible hitch;
     * 0 disables buffering (state applies the moment it drains).
     */
    interpolationDelayTicks?: number;
    /** Enable client-side prediction for the entities this connection owns. */
    prediction?: PredictionOptions;
}

export class ReplicationClient {
    private readonly world_: World;
    private readonly netIds_ = new NetIds();
    private offDespawn_: (() => void) | null = null;
    private channel_: NetChannel | null = null;
    private table_: ReplicationTable | null = null;
    private connectionId_ = 0;
    private serverTick_ = 0;
    private readonly pendingFrames_: Uint8Array[] = [];
    private readonly pendingSpawns_: ReplSpawnBatch[] = [];
    private readonly pendingDespawns_: ReplDespawnBatch[] = [];
    private readonly interp_: InterpolationState | null;
    private inputSeq_ = 0;
    private prediction_: PredictionOptions | null;
    /** Sent-but-unacknowledged input commands, oldest first (replay order). */
    private readonly pendingInputs_: ReplInputMsg[] = [];
    private ackedSeq_ = 0;
    /** Last authoritative value of every replicated field of every OWNED
     *  entity: netId → componentId → field record. Deltas land here (never in
     *  the live components); reconciliation rebuilds live = this ⊕ replay. */
    private readonly authority_ = new Map<number, Map<number, Record<string, unknown>>>();
    private fixedDelta_ = 1 / 60;

    constructor(world: World, options: ReplicationClientOptions = {}) {
        this.world_ = world;
        const delay = options.interpolationDelayTicks ?? 2;
        this.interp_ = delay > 0 ? new InterpolationState(delay) : null;
        this.prediction_ = options.prediction ?? null;
        this.offDespawn_ = world.onDespawn((e) => this.netIds_.unregisterEntity(e));
    }

    get table(): ReplicationTable {
        return (this.table_ ??= buildReplicationTable());
    }

    get netIds(): NetIds {
        return this.netIds_;
    }

    get connected(): boolean {
        return this.channel_ !== null && this.connectionId_ !== 0;
    }

    get connectionId(): number {
        return this.connectionId_;
    }

    /** The tick stamped on the newest applied state (server time axis). */
    get serverTick(): number {
        return this.serverTick_;
    }

    private get refs_(): EntityRefMap {
        return {
            toWire: (entity) => this.netIds_.netIdOf(entity as Entity) ?? 0,
            fromWire: (netId) => (this.netIds_.entityOf(netId) as number | undefined) ?? 0,
        };
    }

    /** Handshake over the transport; rejects (and detaches) on any mismatch. */
    async connect(transport: NetTransport): Promise<void> {
        if (this.channel_) throw new Error('[repl] client already connected');
        const channel = new NetChannel(transport);
        this.channel_ = channel;

        // Handlers first: the initial spawn batch may hit the wire before the
        // hello response settles on this side. Batches queue until the fixed
        // step applies them, so ordering stays deterministic either way.
        channel.on<ReplSpawnBatch>(ReplMsg.spawn, (batch) => this.pendingSpawns_.push(batch));
        channel.on<ReplDespawnBatch>(ReplMsg.despawn, (batch) => this.pendingDespawns_.push(batch));
        channel.on<ReplAckMsg>(ReplMsg.ack, (ack) => {
            if (ack.seq > this.ackedSeq_) this.ackedSeq_ = ack.seq;
        });
        channel.onBinary(REPLICATION_CHANNEL, (payload) => {
            // Copy out: the payload view may alias a transport-owned buffer.
            this.pendingFrames_.push(payload.slice());
        });

        const hello: ReplHelloRequest = {
            protocolVersion: REPLICATION_PROTOCOL_VERSION,
            abiHash: ABI_LAYOUT_HASH,
            components: tableSchemas(this.table),
        };
        let res: ReplHelloResponse;
        try {
            res = await channel.request<ReplHelloResponse>(ReplMsg.hello, hello);
        } catch (err) {
            this.disconnect();
            throw err;
        }
        if (!res.ok) {
            this.disconnect();
            throw new Error(`[repl] server refused connection: ${res.error}`);
        }
        this.connectionId_ = res.connectionId;
        this.serverTick_ = res.tick;
        if (res.fixedDelta > 0) this.fixedDelta_ = res.fixedDelta;
    }

    /** @internal Keep the replay dt in lockstep with the app (plugin-fed). */
    setFixedDelta(dt: number): void {
        if (dt > 0) this.fixedDelta_ = dt;
    }

    get predictionEnabled(): boolean {
        return this.prediction_ !== null;
    }

    /**
     * Enable (or reconfigure) prediction after construction — the path for
     * game code whose connection a HOST made (the editor's multiplayer
     * preview connects the client realm itself, options-free): call from a
     * fixed-tick system once the session is a client. Owned entities that
     * already spawned get their authority copies seeded from current state.
     */
    enablePrediction(options: PredictionOptions): void {
        this.prediction_ = options;
        for (const e of this.ownedEntities_()) {
            const netId = this.netIds_.netIdOf(e);
            if (netId !== undefined && !this.authority_.has(netId)) {
                this.seedAuthority_(netId, e);
            }
        }
    }

    disconnect(): void {
        this.channel_?.dispose();
        this.channel_ = null;
        this.connectionId_ = 0;
        // Retire the despawn subscription and all accumulated state — otherwise
        // every Play→Stop / reconnect cycle leaks a closure that keeps this dead
        // client alive (and mutating it on future despawns), plus stale queues.
        this.offDespawn_?.();
        this.offDespawn_ = null;
        this.netIds_.clear();
        this.authority_.clear();
        this.pendingFrames_.length = 0;
        this.pendingSpawns_.length = 0;
        this.pendingDespawns_.length = 0;
        this.pendingInputs_.length = 0;
    }

    /** Send an input command (typically the InputMap's evaluated action values,
     *  once per fixed tick — with prediction enabled that cadence is the
     *  contract, since the server consumes one command per tick). The seq
     *  stamp makes stale deliveries harmless. With prediction the command also
     *  applies to the owned entities immediately. */
    sendInput(actions: Record<string, unknown>): void {
        if (!this.channel_) return;
        const msg: ReplInputMsg = { seq: ++this.inputSeq_, actions };
        this.channel_.send<ReplInputMsg>(ReplMsg.input, msg);
        if (!this.prediction_) return;
        this.pendingInputs_.push(msg);
        const cap = this.prediction_.maxPendingInputs ?? 120;
        if (this.pendingInputs_.length > cap) this.pendingInputs_.shift();
        for (const e of this.ownedEntities_()) {
            this.prediction_.apply(this.world_, e, actions, this.fixedDelta_);
        }
    }

    /** True when this client's connection owns the entity (Replicated.owner). */
    ownsEntity(entity: Entity): boolean {
        const repl = this.world_.tryGet(entity, Replicated) as { owner: number } | null;
        return repl !== null && repl.owner === this.connectionId_ && this.connectionId_ !== 0;
    }

    /** Apply everything received since the last fixed step. Spawns before
     *  state (a frame may reference an entity spawned in the same flush).
     *  With prediction enabled, ends by reconciling every owned entity:
     *  live state ← authority copy ⊕ replay of unacknowledged inputs. */
    applyPending(): void {
        while (this.pendingSpawns_.length > 0) {
            this.applySpawnBatch_(this.pendingSpawns_.shift()!);
        }
        while (this.pendingFrames_.length > 0) {
            this.applyStateFrame_(decodeStateFrame(this.pendingFrames_.shift()!, this.table, this.refs_));
        }
        while (this.pendingDespawns_.length > 0) {
            this.applyDespawnBatch_(this.pendingDespawns_.shift()!);
        }
        if (this.prediction_) {
            while (this.pendingInputs_.length > 0 && this.pendingInputs_[0].seq <= this.ackedSeq_) {
                this.pendingInputs_.shift();
            }
            this.reconcilePredicted_();
        }
    }

    /** Rebuild every owned entity's live state as authority ⊕ pending replay
     *  (⊕ a decaying visual error when smoothing is on). Idempotent modulo the
     *  error decay — it runs unconditionally each fixed step. */
    private reconcilePredicted_(): void {
        const owned = this.ownedEntities_();
        if (owned.length === 0) return;

        // Smoothing: what the player SAW before this rebuild. The snap below
        // replaces field references (never mutates them), so these stay valid.
        const smoothing = this.prediction_!.smoothing;
        const seen = smoothing ? new Map<Entity, Map<number, Record<string, unknown>>>() : null;
        if (seen) {
            for (const e of owned) {
                const perComp = new Map<number, Record<string, unknown>>();
                for (const te of this.table.entries) {
                    if (!this.world_.has(e, te.def)) continue;
                    const data = this.world_.tryGet(e, te.def) as Record<string, unknown>;
                    const prev: Record<string, unknown> = {};
                    for (const f of te.fields) prev[f] = data[f];
                    perComp.set(te.id, prev);
                }
                seen.set(e, perComp);
            }
        }

        for (const e of owned) {
            const netId = this.netIds_.netIdOf(e);
            if (netId === undefined) continue;
            const perComp = this.authority_.get(netId);
            if (!perComp) continue;
            for (const [componentId, snap] of perComp) {
                const te = this.table.entries[componentId];
                if (!te) continue;
                const existing = this.world_.tryGet(e, te.def) as Record<string, unknown> | null;
                const target = existing ?? {};
                for (const f of te.fields) {
                    // Clone: replay mutates live objects in place; the
                    // authority copy must never alias them.
                    if (f in snap) target[f] = cloneValue(snap[f]);
                }
                if (existing) {
                    this.world_.set(e, te.def, target);
                } else {
                    this.world_.insert(e, te.def, target);
                }
            }
        }
        // Replay tick-by-tick across all owned entities — the same order the
        // server applies the queue to the connection's entities.
        for (const input of this.pendingInputs_) {
            for (const e of owned) {
                this.prediction_!.apply(this.world_, e, input.actions, this.fixedDelta_);
            }
        }

        // Smoothing: blend the rebuilt state toward what was on screen, with
        // the error halving every halfLife seconds. Next tick's rebuild wipes
        // it, so the error decays instead of compounding.
        if (smoothing && seen) {
            const keep = Math.pow(0.5, this.fixedDelta_ / smoothing.halfLife);
            const maxError = smoothing.maxError ?? Infinity;
            for (const e of owned) {
                // Annotated: some tsc releases flag this chain as circular
                // inference (TS7022) without them.
                const perComp: Map<number, Record<string, unknown>> | undefined = seen.get(e);
                if (!perComp) continue;
                for (const [componentId, prev] of perComp) {
                    const te: ReplicationTableEntry | undefined = this.table.entries[componentId];
                    if (!te || !this.world_.has(e, te.def)) continue;
                    const data = this.world_.tryGet(e, te.def) as Record<string, unknown>;
                    let changed = false;
                    for (let i = 0; i < te.fields.length; i++) {
                        const f = te.fields[i];
                        if (!(f in prev)) continue;
                        const blended = smoothValue(te.shapes[i], prev[f], data[f], keep, maxError);
                        if (blended !== data[f]) {
                            data[f] = blended;
                            changed = true;
                        }
                    }
                    if (changed) this.world_.set(e, te.def, data);
                }
            }
        }
    }

    private ownedEntities_(): Entity[] {
        const out: Entity[] = [];
        if (this.connectionId_ === 0) return out;
        for (const e of this.world_.getEntitiesWithComponents([Replicated])) {
            const repl = this.world_.tryGet(e, Replicated) as ReplicatedData | null;
            if (repl && repl.owner === this.connectionId_) out.push(e);
        }
        return out;
    }

    /** Whether this netId's state is under local prediction (owned + enabled). */
    private isPredicted_(netId: number): boolean {
        if (!this.prediction_) return false;
        const e = this.netIds_.entityOf(netId);
        if (e === undefined || !this.world_.valid(e)) return false;
        const repl = this.world_.tryGet(e, Replicated) as ReplicatedData | null;
        return repl !== null && repl.owner === this.connectionId_;
    }

    private applySpawnBatch_(batch: ReplSpawnBatch): void {
        for (const spawn of batch.entities) {
            this.spawnGhost_(spawn);
        }
        // Parent after the whole batch so forward references resolve.
        for (const spawn of batch.entities) {
            if (spawn.parentNetId !== 0) {
                const child = this.netIds_.entityOf(spawn.netId);
                const parent = this.netIds_.entityOf(spawn.parentNetId);
                if (child !== undefined && parent !== undefined) {
                    this.world_.setParent(child, parent);
                }
            }
        }
    }

    private spawnGhost_(spawn: ReplSpawnEntity): void {
        if (this.netIds_.entityOf(spawn.netId) !== undefined) return; // duplicate delivery
        const e = this.world_.spawn(spawn.name || undefined);
        for (const comp of spawn.components) {
            const data = this.remapEntityRefs_(comp.type, comp.data);
            loadComponent(this.world_, e, { type: comp.type, data }, spawn.name);
        }
        this.world_.insert(e, NetGhost, {});
        this.netIds_.register(spawn.netId, e);
        this.seedAuthority_(spawn.netId, e);
    }

    /** Seed the authority copy for a freshly spawned OWNED entity from its
     *  just-loaded state (the spawn payload IS the authoritative baseline). */
    private seedAuthority_(netId: number, e: Entity): void {
        if (!this.isPredicted_(netId)) return;
        const perComp = new Map<number, Record<string, unknown>>();
        for (const te of this.table.entries) {
            if (!this.world_.has(e, te.def)) continue;
            const data = this.world_.tryGet(e, te.def) as Record<string, unknown>;
            const snap: Record<string, unknown> = {};
            for (const f of te.fields) snap[f] = cloneValue(data[f]);
            perComp.set(te.id, snap);
        }
        this.authority_.set(netId, perComp);
    }

    private remapEntityRefs_(type: string, data: Record<string, unknown>): Record<string, unknown> {
        const entityFields = getComponent(type)?.entityFields ?? [];
        if (entityFields.length === 0) return { ...data };
        const out = { ...data };
        for (const f of entityFields) {
            if (typeof out[f] === 'number') {
                out[f] = (this.netIds_.entityOf(out[f] as number) as number | undefined) ?? 0;
            }
        }
        return out;
    }

    private applyDespawnBatch_(batch: ReplDespawnBatch): void {
        for (const netId of batch.netIds) {
            const e = this.netIds_.entityOf(netId);
            this.netIds_.unregister(netId);
            this.interp_?.drop(netId);
            this.authority_.delete(netId);
            if (e !== undefined && this.world_.valid(e)) {
                this.world_.despawn(e);
            }
        }
    }

    private applyStateFrame_(frame: StateFrame): void {
        if (frame.tick > this.serverTick_) this.serverTick_ = frame.tick;
        for (const entry of frame.entries) {
            // Predicted (owned) entities: authoritative values land in the
            // authority copy — never the live components, never interpolation.
            // Reconciliation rebuilds the live state at the end of the flush.
            if (this.isPredicted_(entry.netId)) {
                this.updateAuthority_(entry.netId, entry.componentId, entry.fieldMask, entry.values);
                continue;
            }
            if (this.interp_) {
                let v = 0;
                const te = this.table.entries[entry.componentId];
                if (!te) continue;
                for (let i = 0; i < te.fields.length; i++) {
                    if (entry.fieldMask & (1 << i)) {
                        this.interp_.push(entry.netId, entry.componentId, i, frame.tick, entry.values[v++]);
                    }
                }
            } else {
                this.applyEntryNow_(entry.netId, entry.componentId, entry.fieldMask, entry.values);
            }
        }
    }

    private updateAuthority_(netId: number, componentId: number, fieldMask: number, values: unknown[]): void {
        const te = this.table.entries[componentId];
        if (!te) return;
        let perComp = this.authority_.get(netId);
        if (!perComp) {
            perComp = new Map();
            this.authority_.set(netId, perComp);
        }
        let snap = perComp.get(componentId);
        if (!snap) {
            snap = {};
            perComp.set(componentId, snap);
        }
        let v = 0;
        for (let i = 0; i < te.fields.length; i++) {
            if (fieldMask & (1 << i)) {
                snap[te.fields[i]] = values[v++];
            }
        }
    }

    private applyEntryNow_(netId: number, componentId: number, fieldMask: number, values: unknown[]): void {
        const e = this.netIds_.entityOf(netId);
        if (e === undefined || !this.world_.valid(e)) return;
        const te = this.table.entries[componentId];
        if (!te) return;
        const existing = this.world_.tryGet(e, te.def) as Record<string, unknown> | null;
        const target = existing ?? {};
        let v = 0;
        for (let i = 0; i < te.fields.length; i++) {
            if (fieldMask & (1 << i)) {
                target[te.fields[i]] = values[v++];
            }
        }
        if (existing) {
            this.world_.set(e, te.def, target);
        } else {
            this.world_.insert(e, te.def, target);
        }
    }

    /** Present the buffered state at the trailing render clock. Runs each
     *  render frame (PostUpdate); `deltaTicks` = render delta in tick units. */
    sampleInterpolation(deltaTicks: number): void {
        if (!this.interp_ || this.interp_.newestTick === 0) return;
        const t = this.interp_.advance(deltaTicks);
        for (const [netId, perComp] of this.interp_.buffers) {
            const e = this.netIds_.entityOf(netId);
            if (e === undefined || !this.world_.valid(e)) continue;
            for (const [componentId, buf] of perComp) {
                const te = this.table.entries[componentId];
                if (!te) continue;
                const existing = this.world_.tryGet(e, te.def) as Record<string, unknown> | null;
                const target = existing ?? {};
                let changed = false;
                for (const [fieldIndex, series] of buf.byField) {
                    const value = series.sample(te.shapes[fieldIndex], t);
                    if (value !== undefined) {
                        target[te.fields[fieldIndex]] = value;
                        changed = true;
                    }
                }
                if (!changed) continue;
                if (existing) {
                    this.world_.set(e, te.def, target);
                } else {
                    this.world_.insert(e, te.def, target);
                }
            }
        }
    }
}
