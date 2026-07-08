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
 */
import type { World } from '../../world';
import type { Entity } from '../../types';
import { getComponent } from '../../component';
import { ABI_LAYOUT_HASH } from '../../component.generated';
import { loadComponent } from '../../scene';
import { NetChannel, type NetTransport } from '../NetChannel';
import { log } from '../../logger';
import {
    REPLICATION_CHANNEL, REPLICATION_PROTOCOL_VERSION, ReplMsg,
    type ReplDespawnBatch, type ReplHelloRequest, type ReplHelloResponse, type ReplSpawnBatch, type ReplSpawnEntity,
} from './protocol';
import {
    buildReplicationTable, decodeStateFrame, tableSchemas,
    type EntityRefMap, type ReplicationTable, type StateFrame,
} from './codec';
import { NetGhost } from './components';
import { NetIds } from './NetIds';
import { InterpolationState } from './interpolation';

export interface ReplicationClientOptions {
    /**
     * How many server ticks the presented state trails the newest received
     * data. Two ticks absorbs one lost/late delivery without a visible hitch;
     * 0 disables buffering (state applies the moment it drains).
     */
    interpolationDelayTicks?: number;
}

export class ReplicationClient {
    private readonly world_: World;
    private readonly netIds_ = new NetIds();
    private channel_: NetChannel | null = null;
    private table_: ReplicationTable | null = null;
    private connectionId_ = 0;
    private serverTick_ = 0;
    private readonly pendingFrames_: Uint8Array[] = [];
    private readonly pendingSpawns_: ReplSpawnBatch[] = [];
    private readonly pendingDespawns_: ReplDespawnBatch[] = [];
    private readonly interp_: InterpolationState | null;

    constructor(world: World, options: ReplicationClientOptions = {}) {
        this.world_ = world;
        const delay = options.interpolationDelayTicks ?? 2;
        this.interp_ = delay > 0 ? new InterpolationState(delay) : null;
        world.onDespawn((e) => this.netIds_.unregisterEntity(e));
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
    }

    disconnect(): void {
        this.channel_?.dispose();
        this.channel_ = null;
        this.connectionId_ = 0;
    }

    /** Apply everything received since the last fixed step. Spawns before
     *  state (a frame may reference an entity spawned in the same flush). */
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
            if (e !== undefined && this.world_.valid(e)) {
                this.world_.despawn(e);
            }
        }
    }

    private applyStateFrame_(frame: StateFrame): void {
        if (frame.tick > this.serverTick_) this.serverTick_ = frame.tick;
        for (const entry of frame.entries) {
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
