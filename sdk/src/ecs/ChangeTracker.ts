// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ChangeTracker.ts
 * @brief   Tracks per-component add/change/remove ticks for change detection queries
 */

import { Entity } from '../types';
import { AnyComponentDef } from './component';

/**
 * Per-component history with per-component retention: rows exist only while a
 * reader holds the component, pruned to the LOWEST claim on it. Two of these
 * exist — removal history and membership topology — because a consumer of one
 * must not keep the other alive; the ownership rule is written once.
 */
class ReaderOwnedJournal {
    private rows_ = new Map<symbol, Array<{ entity: Entity; tick: number }>>();
    private readers_ = new Map<symbol, Map<number, number>>();

    hasReaders(componentId: symbol): boolean {
        return this.readers_.has(componentId);
    }

    record(componentId: symbol, entity: Entity, tick: number): void {
        let buffer = this.rows_.get(componentId);
        if (!buffer) {
            buffer = [];
            this.rows_.set(componentId, buffer);
        }
        buffer.push({ entity, tick });
    }

    /** Rows after `sinceTick`, in the order they happened. May repeat an entity. */
    since(componentId: symbol, sinceTick: number): Entity[] {
        const buffer = this.rows_.get(componentId);
        if (!buffer) return [];
        const out: Entity[] = [];
        for (const row of buffer) if (row.tick > sinceTick) out.push(row.entity);
        return out;
    }

    register(componentId: symbol, readerId: number, retainFromTick: number): void {
        let readers = this.readers_.get(componentId);
        if (!readers) {
            readers = new Map();
            this.readers_.set(componentId, readers);
        }
        readers.set(readerId, retainFromTick);
    }

    advance(componentId: symbol, readerId: number, lastTick: number): void {
        const readers = this.readers_.get(componentId);
        if (!readers?.has(readerId)) return;
        readers.set(readerId, lastTick + 1);
        this.prune_(componentId);
    }

    dispose(componentId: symbol, readerId: number): void {
        const readers = this.readers_.get(componentId);
        if (!readers) return;
        readers.delete(readerId);
        this.prune_(componentId);
    }

    readerCount(componentId: symbol): number {
        return this.readers_.get(componentId)?.size ?? 0;
    }

    totalRows(): number {
        let n = 0;
        for (const buffer of this.rows_.values()) n += buffer.length;
        return n;
    }

    private prune_(componentId: symbol): void {
        const readers = this.readers_.get(componentId);
        if (!readers || readers.size === 0) {
            this.readers_.delete(componentId);
            this.rows_.delete(componentId);
            return;
        }
        const buffer = this.rows_.get(componentId);
        if (!buffer) return;
        let safe = Infinity;
        for (const from of readers.values()) if (from < safe) safe = from;
        let writeIdx = 0;
        for (let i = 0; i < buffer.length; i++) {
            if (buffer[i].tick >= safe) buffer[writeIdx++] = buffer[i];
        }
        buffer.length = writeIdx;
        if (writeIdx === 0) this.rows_.delete(componentId);
    }
}

export class ChangeTracker {
    private worldTick_ = 0;
    private componentAddedTicks_ = new Map<symbol, Map<Entity, number>>();
    private componentChangedTicks_ = new Map<symbol, Map<Entity, number>>();
    private readonly removals_ = new ReaderOwnedJournal();
    /** Membership moves, independent of ordinary change tracking. */
    private readonly topology_ = new ReaderOwnedJournal();
    private trackedComponents_ = new Set<symbol>();
    // The most recent worldTick at which ANY entity changed each component — an
    // O(1) "did anything change since tick T" gate (vs scanning the per-entity map).
    private componentLastChangedTick_ = new Map<symbol, number>();
    private nextReaderId_ = 1;

    advanceTick(): void {
        this.worldTick_++;
    }

    getWorldTick(): number {
        return this.worldTick_;
    }

    enableChangeTracking(component: AnyComponentDef): void {
        this.trackedComponents_.add(component._id);
    }

    isAddedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        const map = this.componentAddedTicks_.get(component._id);
        if (!map) return false;
        const tick = map.get(entity);
        return tick !== undefined && tick > sinceTick;
    }

    isChangedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        const map = this.componentChangedTicks_.get(component._id);
        if (!map) return false;
        const tick = map.get(entity);
        return tick !== undefined && tick > sinceTick;
    }

    /** True if ANY entity changed `component` after `sinceTick`. O(1) — reads the
     *  per-component last-changed tick, not the per-entity map. */
    anyChangedSince(component: AnyComponentDef, sinceTick: number): boolean {
        return (this.componentLastChangedTick_.get(component._id) ?? -1) > sinceTick;
    }

    getRemovedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        return this.removals_.since(component._id, sinceTick);
    }

    /**
     * Entities whose MEMBERSHIP in `component` moved after `sinceTick` — gained
     * or lost, and deliberately not saying which. A consumer re-reads the world
     * to find out; this only says who is worth re-reading.
     */
    getTopologyChangedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        return this.topology_.since(component._id, sinceTick);
    }

    registerTopologyReaderFrom(component: AnyComponentDef, retainFromTick: number): number {
        const id = this.nextReaderId_++;
        this.topology_.register(component._id, id, retainFromTick);
        return id;
    }

    advanceTopologyReader(component: AnyComponentDef, readerId: number, lastRunTick: number): void {
        this.topology_.advance(component._id, readerId, lastRunTick);
    }

    disposeTopologyReader(component: AnyComponentDef, readerId: number): void {
        this.topology_.dispose(component._id, readerId);
    }

    /** @internal How many readers hold `component`'s membership journal. */
    topologyReaderCount(component: AnyComponentDef): number {
        return this.topology_.readerCount(component._id);
    }

    /**
     * Take out a claim on `component`'s removal history. History begins HERE:
     * a new reader does not inherit rows another reader happened to leave, so
     * ownership is never ambiguous.
     */
    registerRemovedReader(component: AnyComponentDef): number {
        return this.registerRemovedReaderFrom(component, this.worldTick_ + 1);
    }

    /**
     * A claim starting at an explicit tick, for a reader whose window is not
     * "since I last ran". A sampler that reads with a one-tick overlap must
     * claim from that same floor, or another reader's prune can take a row it
     * was always going to ask for.
     */
    registerRemovedReaderFrom(component: AnyComponentDef, retainFromTick: number): number {
        const id = this.nextReaderId_++;
        this.removals_.register(component._id, id, retainFromTick);
        return id;
    }

    /**
     * This reader has finished a run whose window ended at `lastRunTick`, so it
     * will never ask for a row at or before it again. `Removed` reads
     * `tick > lastRunTick`, which is why the claim is the tick after.
     */
    advanceRemovedReader(component: AnyComponentDef, readerId: number, lastRunTick: number): void {
        this.removals_.advance(component._id, readerId, lastRunTick);
    }

    /** Give up the claim, and let the watermark move at once — history with no
     *  owner is not history anyone can ask for. */
    disposeRemovedReader(component: AnyComponentDef, readerId: number): void {
        this.removals_.dispose(component._id, readerId);
    }

    /** @internal How many readers hold `component`'s history — for the fixtures
     *  that assert a disposed reader stopped pinning it. */
    removedReaderCount(component: AnyComponentDef): number {
        return this.removals_.readerCount(component._id);
    }

    recordAdded(component: AnyComponentDef, entity: Entity): void {
        // BEFORE the tracking gate: a membership journal is what lets a consumer
        // follow arrivals and departures WITHOUT enrolling the component in
        // ordinary change tracking, and paying that tax on every field write.
        if (this.topology_.hasReaders(component._id)) {
            this.topology_.record(component._id, entity, this.worldTick_);
        }
        if (!this.trackedComponents_.has(component._id)) return;
        let map = this.componentAddedTicks_.get(component._id);
        if (!map) {
            map = new Map();
            this.componentAddedTicks_.set(component._id, map);
        }
        map.set(entity, this.worldTick_);
    }

    /**
     * Whether anything is asking about this component's changes. `recordChanged`
     * self-gates on the same answer; this exists so a caller marking a whole
     * query's worth of entities can ask ONCE instead of per entity.
     */
    isTracked(component: AnyComponentDef): boolean {
        return this.trackedComponents_.has(component._id);
    }

    recordChanged(component: AnyComponentDef, entity: Entity): void {
        if (!this.trackedComponents_.has(component._id)) return;
        let map = this.componentChangedTicks_.get(component._id);
        if (!map) {
            map = new Map();
            this.componentChangedTicks_.set(component._id, map);
        }
        map.set(entity, this.worldTick_);
        this.componentLastChangedTick_.set(component._id, this.worldTick_);
    }

    recordRemoved(component: AnyComponentDef, entity: Entity): void {
        this.recordRemovedById(component._id, entity);
    }

    /**
     * The gate lives here rather than in each caller: despawn reaches script
     * components through this id-only entry point and builtins through
     * recordRemoved, and when only the latter checked, the same despawn was
     * recorded for one kind and dropped for the other.
     */
    recordRemovedById(componentId: symbol, entity: Entity): void {
        // Same reason as `recordAdded`: first, and gated on its own readers.
        if (this.topology_.hasReaders(componentId)) {
            this.topology_.record(componentId, entity, this.worldTick_);
        }
        // A row is stored only for a component someone reads history of. With
        // `Changed(C)` alone this is the whole difference between a buffer that
        // grows with every despawn for the life of the world, and none at all.
        if (this.removals_.hasReaders(componentId)) {
            this.removals_.record(componentId, entity, this.worldTick_);
        }
        if (!this.trackedComponents_.has(componentId)) return;
        this.componentAddedTicks_.get(componentId)?.delete(entity);
        this.componentChangedTicks_.get(componentId)?.delete(entity);
        // Losing a component IS a change to it. Without this, `anyChangedSince`
        // — which reads only this watermark — says nothing happened, and a
        // consumer that gates work on it never learns the component is gone.
        // The UI layout did exactly that: removing a FlexContainer left its
        // padding and justification laying the node out for the rest of the run.
        this.componentLastChangedTick_.set(componentId, this.worldTick_);
    }

    /**
     * @internal Live map sizes for the resource census.
     *
     * `removedRows` is bounded by what registered readers still owe: rows exist
     * only while a `Removed` reader holds the component, and are pruned to the
     * lowest claim whenever one advances or goes away.
     */
    sizes(): { tracked: number; addedRows: number; changedRows: number; removedRows: number } {
        const rowsIn = (maps: Map<symbol, Map<Entity, number>>): number => {
            let n = 0;
            for (const m of maps.values()) n += m.size;
            return n;
        };
        const removedRows = this.removals_.totalRows();
        return {
            tracked: this.trackedComponents_.size,
            addedRows: rowsIn(this.componentAddedTicks_),
            changedRows: rowsIn(this.componentChangedTicks_),
            removedRows,
        };
    }
}
