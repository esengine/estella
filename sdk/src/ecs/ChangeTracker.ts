// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ChangeTracker.ts
 * @brief   Tracks per-component add/change/remove ticks for change detection queries
 */

import { Entity } from '../types';
import { AnyComponentDef } from './component';

export class ChangeTracker {
    private worldTick_ = 0;
    private componentAddedTicks_ = new Map<symbol, Map<Entity, number>>();
    private componentChangedTicks_ = new Map<symbol, Map<Entity, number>>();
    private componentRemovedBuffer_ = new Map<symbol, Array<{ entity: Entity; tick: number }>>();
    private trackedComponents_ = new Set<symbol>();
    // The most recent worldTick at which ANY entity changed each component — an
    // O(1) "did anything change since tick T" gate (vs scanning the per-entity map).
    private componentLastChangedTick_ = new Map<symbol, number>();
    // Who still needs removal history, and from which tick. Removal rows are
    // produced ONLY for a component in here: `Changed(C)` needs to know the
    // topology moved, never which entity lost C at tick 738.
    private removedReaders_ = new Map<symbol, Map<number, number>>();
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
        const buffer = this.componentRemovedBuffer_.get(component._id);
        if (!buffer) return [];
        const result: Entity[] = [];
        for (const entry of buffer) {
            if (entry.tick > sinceTick) {
                result.push(entry.entity);
            }
        }
        return result;
    }

    /**
     * Take out a claim on `component`'s removal history. History begins HERE:
     * a new reader does not inherit rows another reader happened to leave, so
     * ownership is never ambiguous.
     */
    registerRemovedReader(component: AnyComponentDef): number {
        let readers = this.removedReaders_.get(component._id);
        if (!readers) {
            readers = new Map();
            this.removedReaders_.set(component._id, readers);
        }
        const id = this.nextReaderId_++;
        readers.set(id, this.worldTick_ + 1);
        return id;
    }

    /**
     * This reader has finished a run whose window ended at `lastRunTick`, so it
     * will never ask for a row at or before it again. `Removed` reads
     * `tick > lastRunTick`, which is why the claim is the tick after.
     */
    advanceRemovedReader(component: AnyComponentDef, readerId: number, lastRunTick: number): void {
        const readers = this.removedReaders_.get(component._id);
        if (!readers?.has(readerId)) return;
        readers.set(readerId, lastRunTick + 1);
        this.pruneRemoved_(component._id);
    }

    /** Give up the claim, and let the watermark move at once — history with no
     *  owner is not history anyone can ask for. */
    disposeRemovedReader(component: AnyComponentDef, readerId: number): void {
        const readers = this.removedReaders_.get(component._id);
        if (!readers) return;
        readers.delete(readerId);
        this.pruneRemoved_(component._id);
    }

    /** @internal How many readers hold `component`'s history — for the fixtures
     *  that assert a disposed reader stopped pinning it. */
    removedReaderCount(component: AnyComponentDef): number {
        return this.removedReaders_.get(component._id)?.size ?? 0;
    }

    /**
     * Drop what no reader of THIS component can still ask for. Per component,
     * never global: a slow reader of one component has no business pinning
     * another's history.
     */
    private pruneRemoved_(componentId: symbol): void {
        const readers = this.removedReaders_.get(componentId);
        if (!readers || readers.size === 0) {
            this.removedReaders_.delete(componentId);
            this.componentRemovedBuffer_.delete(componentId);
            return;
        }
        const buffer = this.componentRemovedBuffer_.get(componentId);
        if (!buffer) return;
        let safe = Infinity;
        for (const from of readers.values()) if (from < safe) safe = from;
        let writeIdx = 0;
        for (let i = 0; i < buffer.length; i++) {
            if (buffer[i].tick >= safe) buffer[writeIdx++] = buffer[i];
        }
        buffer.length = writeIdx;
        if (writeIdx === 0) this.componentRemovedBuffer_.delete(componentId);
    }

    recordAdded(component: AnyComponentDef, entity: Entity): void {
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
        // A row is stored only for a component someone reads history of. With
        // `Changed(C)` alone this is the whole difference between a buffer that
        // grows with every despawn for the life of the world, and none at all.
        if (this.removedReaders_.has(componentId)) {
            let buffer = this.componentRemovedBuffer_.get(componentId);
            if (!buffer) {
                buffer = [];
                this.componentRemovedBuffer_.set(componentId, buffer);
            }
            buffer.push({ entity, tick: this.worldTick_ });
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
        let removedRows = 0;
        for (const buffer of this.componentRemovedBuffer_.values()) removedRows += buffer.length;
        return {
            tracked: this.trackedComponents_.size,
            addedRows: rowsIn(this.componentAddedTicks_),
            changedRows: rowsIn(this.componentChangedTicks_),
            removedRows,
        };
    }
}
