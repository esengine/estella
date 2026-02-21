import type { App, Plugin } from '../app';
import { registerComponent, LocalTransform, Name } from '../component';
import type { LocalTransformData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Input } from '../input';
import type { InputState } from '../input';
import type { Entity } from '../types';
import { ListView } from './ListView';
import type { ListViewData, ListViewItemRenderer } from './ListView';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { Interactable } from './Interactable';
import { UIMask } from './UIMask';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { ensureComponent } from './uiHelpers';
import { SCROLL_WHEEL_SENSITIVITY } from './uiConstants';

interface ListViewState {
    visibleStart: number;
    visibleEnd: number;
    itemEntities: Map<number, Entity>;
    renderer: ListViewItemRenderer | null;
}

let activeListViewStates: Map<Entity, ListViewState> | null = null;

export function setListViewRenderer(entity: Entity, renderer: ListViewItemRenderer): void {
    if (!activeListViewStates) {
        console.warn('setListViewRenderer: ListViewPlugin has not been initialized');
        return;
    }
    const state = activeListViewStates.get(entity);
    if (state) {
        state.renderer = renderer;
    } else {
        activeListViewStates.set(entity, {
            visibleStart: 0,
            visibleEnd: 0,
            itemEntities: new Map(),
            renderer,
        });
    }
}

export class ListViewPlugin implements Plugin {

    build(app: App): void {
        registerComponent('ListView', ListView);

        const world = app.world;
        const listViewStates = new Map<Entity, ListViewState>();
        activeListViewStates = listViewStates;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input)],
            (input: InputState) => {
                for (const [e, st] of listViewStates) {
                    if (!world.valid(e)) {
                        for (const itemEntity of st.itemEntities.values()) {
                            if (world.valid(itemEntity)) {
                                world.despawn(itemEntity);
                            }
                        }
                        listViewStates.delete(e);
                    }
                }

                const entities = world.getEntitiesWithComponents([ListView, UIRect]);
                for (const entity of entities) {
                    ensureComponent(world, entity, Interactable, { enabled: true, blockRaycast: true });
                    ensureComponent(world, entity, UIMask, { enabled: true, mode: 'scissor' });

                    let state = listViewStates.get(entity);
                    if (!state) {
                        state = {
                            visibleStart: 0,
                            visibleEnd: 0,
                            itemEntities: new Map(),
                            renderer: null,
                        };
                        listViewStates.set(entity, state);
                    }

                    const lv = world.get(entity, ListView) as ListViewData;
                    const rect = world.get(entity, UIRect) as UIRectData;
                    const viewHeight = rect._computedHeight ?? rect.size.y;
                    const viewWidth = rect._computedWidth ?? rect.size.x;

                    const interaction = world.has(entity, UIInteraction)
                        ? world.get(entity, UIInteraction) as UIInteractionData
                        : null;

                    if (interaction?.hovered) {
                        const scroll = input.getScrollDelta();
                        if (scroll.y !== 0) {
                            lv.scrollY += scroll.y * SCROLL_WHEEL_SENSITIVITY;
                        }
                    }

                    const maxScroll = Math.max(0, lv.itemCount * lv.itemHeight - viewHeight);
                    lv.scrollY = Math.max(0, Math.min(lv.scrollY, maxScroll));

                    const startIdx = Math.max(0, Math.floor(lv.scrollY / lv.itemHeight) - lv.overscan);
                    const endIdx = Math.min(
                        lv.itemCount,
                        Math.ceil((lv.scrollY + viewHeight) / lv.itemHeight) + lv.overscan
                    );

                    for (const [idx, itemEntity] of state.itemEntities) {
                        if (idx < startIdx || idx >= endIdx) {
                            if (world.valid(itemEntity)) {
                                world.despawn(itemEntity);
                            }
                            state.itemEntities.delete(idx);
                        }
                    }

                    for (let idx = startIdx; idx < endIdx; idx++) {
                        let itemEntity = state.itemEntities.get(idx);
                        if (!itemEntity || !world.valid(itemEntity)) {
                            itemEntity = world.spawn();
                            world.insert(itemEntity, Name, { value: `ListItem_${idx}` });
                            world.insert(itemEntity, UIRect, {
                                anchorMin: { x: 0, y: 1 },
                                anchorMax: { x: 1, y: 1 },
                                offsetMin: { x: 0, y: 0 },
                                offsetMax: { x: 0, y: 0 },
                                size: { x: viewWidth, y: lv.itemHeight },
                                pivot: { x: 0.5, y: 1 },
                            });
                            world.setParent(itemEntity, entity);
                            state.itemEntities.set(idx, itemEntity);

                            if (state.renderer) {
                                state.renderer(idx, itemEntity);
                            }
                        }

                        if (world.has(itemEntity, LocalTransform)) {
                            const lt = world.get(itemEntity, LocalTransform) as LocalTransformData;
                            lt.position.y = -(idx * lv.itemHeight - lv.scrollY);
                            world.insert(itemEntity, LocalTransform, lt);
                        }
                    }

                    state.visibleStart = startIdx;
                    state.visibleEnd = endIdx;
                }
            },
            { name: 'ListViewSystem' }
        ));
    }
}

export const listViewPlugin = new ListViewPlugin();
