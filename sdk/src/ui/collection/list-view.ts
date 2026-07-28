// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Transform, type TransformData } from '../../ecs/component';
import type { Entity, Vec2 } from '../../types';
import type { World } from '../../ecs/world';

import type { DataSource } from './data-source';
import type { LayoutProvider, Rect } from './layout-provider';
import { ViewPool, type ViewPoolTemplate } from './view-pool';
import { log } from '../../logger';

export interface ListViewItemTemplate<T = unknown> extends ViewPoolTemplate<T> {}

export interface ListViewOptions<T = unknown> {
    world: World;
    /** Entity that hosts the scrolling content (items are parented here). */
    parent: Entity;
    dataSource: DataSource<T>;
    layout: LayoutProvider;
    /** Size of the visible window into the content, in content-local units. */
    viewportSize: Vec2;
    /** Map of item type → template; every `getItemType(i)` result must have a match. */
    templates: Record<string, ListViewItemTemplate<T>>;
    /**
     * Extra index count kept mounted on each side of the strict visible range.
     * Default 2. For grid layouts set this to `columns * 2` or similar for
     * row-level padding.
     */
    recycleBuffer?: number;
    /**
     * Override how an item entity is positioned for its computed rect.
     * Default writes `Transform.position = (centerX, -centerY, 0)` so the
     * item's center lands on the layout rect center in a y-up world.
     */
    placeItem?: (world: World, entity: Entity, rect: Rect, index: number) => void;
    /** Called after each bind, useful for ad-hoc per-item tweaks. */
    onItemBound?: (entity: Entity, data: T, index: number) => void;
    /** Toggle visibility on pool acquire/release. Forwarded to ViewPool. */
    setVisible?: (world: World, entity: Entity, visible: boolean) => void;
}

function defaultPlaceItem(world: World, entity: Entity, rect: Rect): void {
    const existing = world.has(entity, Transform)
        ? (world.get(entity, Transform) as TransformData)
        : {
              position: { x: 0, y: 0, z: 0 },
              rotation: { w: 1, x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              worldPosition: { x: 0, y: 0, z: 0 },
              worldRotation: { w: 1, x: 0, y: 0, z: 0 },
              worldScale: { x: 1, y: 1, z: 1 },
          };
    existing.position.x = rect.x + rect.width / 2;
    // List coords grow down, world coords grow up → flip.
    existing.position.y = -(rect.y + rect.height / 2);
    world.insert(entity, Transform, existing);
}

interface MountRecord {
    entity: Entity;
    itemType: string;
}

/**
 * Virtualized list driver. Owns a ViewPool + DataSource subscription;
 * on each `update()` computes the visible index range and syncs the
 * mounted item set to match.
 *
 * Does not own input — callers drive scrolling by calling
 * `setScrollOffset()`. Typical wiring: a ScrollContainer primitive (or
 * the app's input layer) computes a new offset and pushes it in.
 */
export class ListView<T = unknown> {
    private readonly world_: World;
    private readonly parent_: Entity;
    private readonly dataSource_: DataSource<T>;
    private readonly layout_: LayoutProvider;
    private readonly pool_: ViewPool;
    private readonly recycleBuffer_: number;
    private readonly placeItem_: (world: World, entity: Entity, rect: Rect, index: number) => void;
    private readonly onItemBound_: ((e: Entity, d: T, i: number) => void) | undefined;
    private readonly mounted_ = new Map<number, MountRecord>();
    private unsubscribeDataSource_: (() => void) | null = null;

    private viewportSize_: Vec2;
    private scrollOffset_: Vec2 = { x: 0, y: 0 };
    private dirty_ = true;
    private disposed_ = false;

    constructor(opts: ListViewOptions<T>) {
        this.world_ = opts.world;
        this.parent_ = opts.parent;
        this.dataSource_ = opts.dataSource;
        this.layout_ = opts.layout;
        this.viewportSize_ = { x: opts.viewportSize.x, y: opts.viewportSize.y };
        this.recycleBuffer_ = opts.recycleBuffer ?? 2;
        this.placeItem_ = opts.placeItem ?? defaultPlaceItem;
        this.onItemBound_ = opts.onItemBound;

        this.pool_ = new ViewPool({ world: opts.world, setVisible: opts.setVisible });
        for (const [type, tpl] of Object.entries(opts.templates)) {
            this.pool_.setTemplate(type, tpl);
        }

        if (this.dataSource_.subscribe) {
            this.unsubscribeDataSource_ = this.dataSource_.subscribe(() => {
                this.dirty_ = true;
                this.invalidateLayout_();
            });
        }
    }

    /** A measured layout caches per-item offsets; drop them when the data (or, for
     *  width-dependent measures like wrapped text, the viewport) changes. No-op for
     *  fixed-size providers. */
    private invalidateLayout_(): void {
        (this.layout_ as { invalidate?: () => void }).invalidate?.();
    }

    /** Current visible window within the content, in content-local coords. */
    getViewport(): Rect {
        return {
            x: this.scrollOffset_.x,
            y: this.scrollOffset_.y,
            width: this.viewportSize_.x,
            height: this.viewportSize_.y,
        };
    }

    /** Total size of the content for the current data count. */
    getContentSize(): Vec2 {
        return this.layout_.getContentSize(this.dataSource_.getCount());
    }

    /** Strict visible index range [start, end). */
    getVisibleRange(): [number, number] {
        return this.layout_.getVisibleRange(this.getViewport(), this.dataSource_.getCount());
    }

    /** Number of entities currently mounted (useful for virtualization tests). */
    getMountedCount(): number {
        return this.mounted_.size;
    }

    setScrollOffset(offset: Vec2): void {
        if (offset.x === this.scrollOffset_.x && offset.y === this.scrollOffset_.y) return;
        this.scrollOffset_ = { x: offset.x, y: offset.y };
        this.dirty_ = true;
    }

    setViewportSize(size: Vec2): void {
        if (size.x === this.viewportSize_.x && size.y === this.viewportSize_.y) return;
        this.viewportSize_ = { x: size.x, y: size.y };
        this.dirty_ = true;
        this.invalidateLayout_(); // width-dependent measures (wrapped text) re-flow
    }

    /** Mark the mount set dirty — the next `update()` will re-sync. */
    refresh(): void {
        this.dirty_ = true;
    }

    /**
     * Sync mounted items to the current viewport + data source.
     * Cheap when nothing has changed (short-circuits on !dirty).
     */
    update(): void {
        if (this.disposed_ || !this.dirty_) return;
        this.dirty_ = false;

        const count = this.dataSource_.getCount();
        const [visStart, visEnd] = this.layout_.getVisibleRange(this.getViewport(), count);

        const bufferedStart = Math.max(0, visStart - this.recycleBuffer_);
        const bufferedEnd = Math.min(count, visEnd + this.recycleBuffer_);

        // Release anything outside the buffered range.
        for (const [index, record] of Array.from(this.mounted_.entries())) {
            if (index < bufferedStart || index >= bufferedEnd) {
                this.pool_.release(record.itemType, record.entity);
                this.mounted_.delete(index);
            }
        }

        // Acquire anything inside the range that isn't already mounted.
        for (let i = bufferedStart; i < bufferedEnd; i++) {
            const existing = this.mounted_.get(i);
            const itemType = this.dataSource_.getItemType?.(i) ?? 'default';

            // A mounted entity is only reusable if its template type still
            // matches — after a data reset the same index can change type, and
            // binding a new type's data to the old template's entity corrupts it.
            if (existing && existing.itemType !== itemType) {
                this.pool_.release(existing.itemType, existing.entity);
                this.mounted_.delete(i);
            }

            let entity: Entity;
            const reusable = this.mounted_.get(i);
            if (reusable) {
                // Item already mounted; bind again in case data updated.
                entity = reusable.entity;
            } else {
                if (!this.pool_.hasTemplate(itemType)) {
                    log.warn('ui', `ListView: No template for item type "${itemType}" at index ${i}`);
                    continue;
                }
                entity = this.pool_.acquire(itemType, this.parent_);
                this.mounted_.set(i, { entity, itemType });
            }

            const data = this.dataSource_.getItem(i);
            this.pool_.bind(itemType, entity, data, i);
            const rect = this.layout_.getItemRect(i);
            this.placeItem_(this.world_, entity, rect, i);
            this.onItemBound_?.(entity, data, i);
        }
    }

    /** Release all mounted items and tear down subscriptions. */
    dispose(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        this.unsubscribeDataSource_?.();
        this.unsubscribeDataSource_ = null;
        for (const record of this.mounted_.values()) {
            this.pool_.release(record.itemType, record.entity);
        }
        this.mounted_.clear();
        this.pool_.dispose();
    }
}

/**
 * Registry of active ListView instances. A plugin owns one of these
 * and invokes `tick()` from a per-frame system.
 */
export class ListViewRegistry {
    private readonly instances_ = new Set<ListView<unknown>>();

    add(list: ListView<unknown>): void {
        this.instances_.add(list);
    }

    remove(list: ListView<unknown>): void {
        this.instances_.delete(list);
    }

    tick(): void {
        for (const list of this.instances_) {
            list.update();
        }
    }

    count(): number {
        return this.instances_.size;
    }
}
