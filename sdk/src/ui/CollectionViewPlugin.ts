import type { App, Plugin } from '../app';
import type { Entity } from '../types';
import { defineSystem, Schedule } from '../system';
import { registerComponent, Transform, type TransformData, Name, Sprite } from '../component';
import { CollectionView, CollectionItem, type CollectionViewData } from './CollectionView';
import { getCollectionAdapter, removeCollectionAdapter, type CollectionAdapter } from './CollectionAdapter';
import { getLayoutProvider, registerLayoutProvider, type LayoutResult } from './LayoutProvider';
import { LinearLayoutProvider } from './layouts/LinearLayoutProvider';
import { LinearLayout } from './layouts/LinearLayout';
import { GridLayoutProvider } from './layouts/GridLayoutProvider';
import { GridLayout } from './layouts/GridLayout';
import { FanLayoutProvider } from './layouts/FanLayoutProvider';
import { FanLayout } from './layouts/FanLayout';
import { ItemPool } from './ItemPool';
import { UIRect, type UIRectData } from './UIRect';
import { getEffectiveWidth, getEffectiveHeight } from './uiHelpers';
import { Image as UIImage } from './Image';

export interface CollectionState {
    pool: ItemPool;
    activeItems: Map<number, Entity>;
    prevItemCount: number;
    dirty: boolean;
}

let globalStates: Map<Entity, CollectionState> | null = null;

export function getCollectionState(entity: Entity): CollectionState | null {
    return globalStates?.get(entity) ?? null;
}

export class CollectionViewPlugin implements Plugin {
    name = 'collectionView';
    dependencies = ['uiLayout'];

    private cleanup_: (() => void) | null = null;

    build(app: App): void {
        registerComponent('CollectionView', CollectionView);
        registerComponent('CollectionItem', CollectionItem);

        registerLayoutProvider('linear', new LinearLayoutProvider());
        registerLayoutProvider('grid', new GridLayoutProvider());
        registerLayoutProvider('fan', new FanLayoutProvider());

        const world = app.world;
        const states = new Map<Entity, CollectionState>();
        globalStates = states;

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [],
            () => {
                for (const [e, st] of states) {
                    if (!world.valid(e) || !world.has(e, CollectionView)) {
                        for (const item of st.activeItems.values()) {
                            if (world.valid(item)) world.despawn(item);
                        }
                        st.pool.clear(world);
                        states.delete(e);
                        removeCollectionAdapter(e);
                    }
                }

                const entities = world.getEntitiesWithComponents([CollectionView, UIRect]);
                for (const entity of entities) {
                    const cv = world.get(entity, CollectionView) as CollectionViewData;
                    const adapter = getCollectionAdapter(entity);
                    const provider = getLayoutProvider(cv.layout);
                    if (!adapter || !provider) continue;

                    let state = states.get(entity);
                    if (!state) {
                        state = { pool: new ItemPool(), activeItems: new Map(), prevItemCount: -1, dirty: true };
                        states.set(entity, state);
                    }

                    const rect = world.get(entity, UIRect) as UIRectData;
                    const viewW = getEffectiveWidth(rect, entity);
                    const viewH = getEffectiveHeight(rect, entity);
                    const viewportSize = { x: viewW, y: viewH };

                    const layoutConfig = this.getLayoutConfig_(world, entity, cv.layout);
                    const selectedSet = new Set(cv.selectedIndices);

                    if (cv.virtualized) {
                        const scrollOffset = { x: 0, y: 0 };

                        const visibleResults = provider.getVisibleRange(
                            scrollOffset, viewportSize, cv.itemCount, cv.overscan, layoutConfig,
                        );

                        const newVisibleIndices = new Set(visibleResults.map(r => r.index));

                        for (const [idx, itemEntity] of state.activeItems) {
                            if (!newVisibleIndices.has(idx)) {
                                const itemType = adapter.getItemType ? adapter.getItemType(idx) : 'default';
                                if (adapter.unbindItem) adapter.unbindItem(itemEntity, idx, world);
                                this.hideItem_(world, itemEntity);
                                state.pool.release(itemEntity, itemType);
                                state.activeItems.delete(idx);
                            }
                        }

                        for (const result of visibleResults) {
                            let itemEntity = state.activeItems.get(result.index);
                            if (!itemEntity || !world.valid(itemEntity)) {
                                const itemType = adapter.getItemType ? adapter.getItemType(result.index) : 'default';
                                itemEntity = state.pool.acquire(itemType);
                                if (itemEntity && world.valid(itemEntity)) {
                                    this.showItem_(world, itemEntity);
                                } else {
                                    itemEntity = this.createItem_(world, entity);
                                    adapter.makeItem(itemEntity, world);
                                }
                                adapter.bindItem(itemEntity, result.index, world);
                                world.insert(itemEntity, CollectionItem, {
                                    collectionEntity: entity,
                                    dataIndex: result.index,
                                    selected: selectedSet.has(result.index),
                                });
                                state.activeItems.set(result.index, itemEntity);
                            }

                            this.positionItem_(world, itemEntity, result);
                        }
                    } else {
                        const needsRebuild = state.prevItemCount !== cv.itemCount || state.dirty;
                        if (needsRebuild) {
                            for (const [idx, itemEntity] of state.activeItems) {
                                if (idx >= cv.itemCount) {
                                    if (adapter.unbindItem) adapter.unbindItem(itemEntity, idx, world);
                                    if (world.valid(itemEntity)) world.despawn(itemEntity);
                                    state.activeItems.delete(idx);
                                }
                            }

                            for (let i = 0; i < cv.itemCount; i++) {
                                if (!state.activeItems.has(i)) {
                                    const itemEntity = this.createItem_(world, entity);
                                    adapter.makeItem(itemEntity, world);
                                    adapter.bindItem(itemEntity, i, world);
                                    world.insert(itemEntity, CollectionItem, {
                                        collectionEntity: entity,
                                        dataIndex: i,
                                        selected: selectedSet.has(i),
                                    });
                                    state.activeItems.set(i, itemEntity);
                                }
                            }
                            state.prevItemCount = cv.itemCount;
                            state.dirty = false;

                            const allResults = provider.getVisibleRange(
                                { x: 0, y: 0 }, viewportSize, cv.itemCount, 0, layoutConfig,
                            );
                            for (const result of allResults) {
                                const itemEntity = state.activeItems.get(result.index);
                                if (itemEntity && world.valid(itemEntity)) {
                                    this.positionItem_(world, itemEntity, result);
                                }
                            }
                        }
                    }
                }
            },
            { name: 'CollectionViewSystem' },
        ), { runAfter: ['UILayoutLateSystem'], runBefore: ['UIRenderOrderSystem'] });

        this.cleanup_ = () => {
            for (const [, st] of states) {
                for (const item of st.activeItems.values()) {
                    if (world.valid(item)) world.despawn(item);
                }
                st.pool.clear(world);
            }
            states.clear();
            globalStates = null;
        };
    }

    private getLayoutConfig_(world: import('../world').World, entity: Entity, layout: string): unknown {
        switch (layout) {
            case 'linear':
                return world.has(entity, LinearLayout) ? world.get(entity, LinearLayout) : null;
            case 'grid':
                return world.has(entity, GridLayout) ? world.get(entity, GridLayout) : null;
            case 'fan':
                return world.has(entity, FanLayout) ? world.get(entity, FanLayout) : null;
            default:
                return null;
        }
    }

    private createItem_(world: import('../world').World, parent: Entity): Entity {
        const item = world.spawn();
        world.insert(item, Name, { value: 'CollectionItem' });
        world.insert(item, UIRect, {
            anchorMin: { x: 0, y: 1 },
            anchorMax: { x: 0, y: 1 },
            offsetMin: { x: 0, y: 0 },
            offsetMax: { x: 0, y: 0 },
            size: { x: 0, y: 0 },
            pivot: { x: 0, y: 1 },
        });
        world.setParent(item, parent);
        return item;
    }

    private positionItem_(
        world: import('../world').World,
        entity: Entity,
        result: LayoutResult,
    ): void {
        if (world.has(entity, UIRect)) {
            const rect = world.get(entity, UIRect) as UIRectData;
            rect.size = { x: result.size.x, y: result.size.y };
            world.insert(entity, UIRect, rect);
        }
        if (world.has(entity, Transform)) {
            const t = world.get(entity, Transform) as TransformData;
            t.position.x = result.position.x;
            t.position.y = -result.position.y;
            if (result.rotation !== undefined) {
                const rad = result.rotation * Math.PI / 180;
                t.rotation.z = Math.sin(rad / 2);
                t.rotation.w = Math.cos(rad / 2);
            }
            world.insert(entity, Transform, t);
        }
    }

    private hideItem_(world: import('../world').World, entity: Entity): void {
        if (world.has(entity, Transform)) {
            const t = world.get(entity, Transform) as TransformData;
            t.scale = { x: 0, y: 0, z: 0 };
            world.insert(entity, Transform, t);
        }
    }

    private showItem_(world: import('../world').World, entity: Entity): void {
        if (world.has(entity, Transform)) {
            const t = world.get(entity, Transform) as TransformData;
            t.scale = { x: 1, y: 1, z: 1 };
            world.insert(entity, Transform, t);
        }
    }
}

export const collectionViewPlugin = new CollectionViewPlugin();
