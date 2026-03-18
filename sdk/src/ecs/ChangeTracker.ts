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
