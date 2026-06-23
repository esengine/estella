// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ChangeTracker.ts
 * @brief   Tracks per-component add/change/remove ticks for change detection queries
 */

import { Entity } from '../types';
import { AnyComponentDef } from '../component';

export class ChangeTracker {
    private worldTick_ = 0;
    private componentAddedTicks_ = new Map<symbol, Map<Entity, number>>();
    private componentChangedTicks_ = new Map<symbol, Map<Entity, number>>();
    private componentRemovedBuffer_ = new Map<symbol, Array<{ entity: Entity; tick: number }>>();
    private trackedComponents_ = new Set<symbol>();
    // The most recent worldTick at which ANY entity changed each component — an
    // O(1) "did anything change since tick T" gate (vs scanning the per-entity map).
    private componentLastChangedTick_ = new Map<symbol, number>();

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

    cleanRemovedBuffer(beforeTick: number): void {
        for (const [id, buffer] of this.componentRemovedBuffer_) {
            let writeIdx = 0;
            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i].tick >= beforeTick) {
                    buffer[writeIdx++] = buffer[i];
                }
            }
            buffer.length = writeIdx;
            if (writeIdx === 0) {
                this.componentRemovedBuffer_.delete(id);
            }
        }
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
        if (!this.trackedComponents_.has(component._id)) return;
        let buffer = this.componentRemovedBuffer_.get(component._id);
        if (!buffer) {
            buffer = [];
            this.componentRemovedBuffer_.set(component._id, buffer);
        }
        buffer.push({ entity, tick: this.worldTick_ });
        this.componentAddedTicks_.get(component._id)?.delete(entity);
        this.componentChangedTicks_.get(component._id)?.delete(entity);
    }

    recordRemovedById(componentId: symbol, entity: Entity): void {
        let buffer = this.componentRemovedBuffer_.get(componentId);
        if (!buffer) {
            buffer = [];
            this.componentRemovedBuffer_.set(componentId, buffer);
        }
        buffer.push({ entity, tick: this.worldTick_ });
        this.componentAddedTicks_.get(componentId)?.delete(entity);
        this.componentChangedTicks_.get(componentId)?.delete(entity);
    }
}
