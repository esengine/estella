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

interface ListViewState {
    visibleStart: number;
    visibleEnd: number;
    itemEntities: Map<number, Entity>;
    renderer: ListViewItemRenderer | null;
}

const listViewStates = new Map<Entity, ListViewState>();

export function setListViewRenderer(entity: Entity, renderer: ListViewItemRenderer): void {
    const state = listViewStates.get(entity);
    if (state) {
        state.renderer = renderer;
    }
}

export class ListViewPlugin implements Plugin {
    build(app: App): void {
        registerComponent('ListView', ListView);

        const world = app.world;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input)],
            (input: InputState) => {
                const entities = world.getEntitiesWithComponents([ListView, UIRect]);
                for (const entity of entities) {
                    if (!world.has(entity, Interactable)) {
                        world.insert(entity, Interactable, { enabled: true, blockRaycast: true });
                    }
                    if (!world.has(entity, UIMask)) {
                        world.insert(entity, UIMask, { enabled: true, mode: 'scissor' });
                    }

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
                    const viewHeight = rect.size.y;

                    const interaction = world.has(entity, UIInteraction)
                        ? world.get(entity, UIInteraction) as UIInteractionData
                        : null;

                    if (interaction?.hovered) {
                        const scroll = input.getScrollDelta();
                        if (scroll.y !== 0) {
                            lv.scrollY += scroll.y * 0.1;
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
                                size: { x: rect.size.x, y: lv.itemHeight },
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
