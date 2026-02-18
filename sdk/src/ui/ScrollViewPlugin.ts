import type { App, Plugin } from '../app';
import { registerComponent, LocalTransform } from '../component';
import type { LocalTransformData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Input } from '../input';
import type { InputState } from '../input';
import type { Entity } from '../types';
import { ScrollView } from './ScrollView';
import type { ScrollViewData } from './ScrollView';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { Interactable } from './Interactable';
import { UIMask } from './UIMask';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';

interface ScrollState {
    isDragging: boolean;
    lastWorldX: number;
    lastWorldY: number;
    velocityX: number;
    velocityY: number;
}

export class ScrollViewPlugin implements Plugin {
    build(app: App): void {
        registerComponent('ScrollView', ScrollView);

        const world = app.world;
        const states = new Map<Entity, ScrollState>();
        let lastTime = 0;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo)],
            (input: InputState, camera: UICameraData) => {
                const now = performance.now() / 1000;
                const dt = lastTime > 0 ? Math.min(now - lastTime, 0.05) : 0;
                lastTime = now;

                if (!camera.valid) return;

                const worldMouse = { x: camera.worldMouseX, y: camera.worldMouseY };

                const entities = world.getEntitiesWithComponents([ScrollView, UIRect]);
                for (const entity of entities) {
                    if (!world.has(entity, Interactable)) {
                        world.insert(entity, Interactable, { enabled: true, blockRaycast: true });
                    }
                    if (!world.has(entity, UIMask)) {
                        world.insert(entity, UIMask, { enabled: true, mode: 'scissor' });
                    }

                    const sv = world.get(entity, ScrollView) as ScrollViewData;
                    const rect = world.get(entity, UIRect) as UIRectData;

                    let state = states.get(entity);
                    if (!state) {
                        state = { isDragging: false, lastWorldX: 0, lastWorldY: 0, velocityX: 0, velocityY: 0 };
                        states.set(entity, state);
                    }

                    const interaction = world.has(entity, UIInteraction)
                        ? world.get(entity, UIInteraction) as UIInteractionData
                        : null;

                    if (interaction?.justPressed) {
                        state.isDragging = true;
                        state.lastWorldX = worldMouse.x;
                        state.lastWorldY = worldMouse.y;
                        state.velocityX = 0;
                        state.velocityY = 0;
                    }

                    if (state.isDragging && input.isMouseButtonDown(0)) {
                        const dx = worldMouse.x - state.lastWorldX;
                        const dy = worldMouse.y - state.lastWorldY;

                        if (sv.horizontalEnabled) {
                            sv.scrollX -= dx;
                            state.velocityX = dt > 0 ? -dx / dt : 0;
                        }
                        if (sv.verticalEnabled) {
                            sv.scrollY -= dy;
                            state.velocityY = dt > 0 ? -dy / dt : 0;
                        }

                        state.lastWorldX = worldMouse.x;
                        state.lastWorldY = worldMouse.y;
                    }

                    if (state.isDragging && input.isMouseButtonReleased(0)) {
                        state.isDragging = false;
                    }

                    if (interaction?.hovered) {
                        const scroll = input.getScrollDelta();
                        if (sv.verticalEnabled && scroll.y !== 0) {
                            sv.scrollY += scroll.y * 0.1;
                            state.velocityY = 0;
                        }
                        if (sv.horizontalEnabled && scroll.x !== 0) {
                            sv.scrollX += scroll.x * 0.1;
                            state.velocityX = 0;
                        }
                    }

                    if (!state.isDragging && sv.inertia && dt > 0) {
                        const decay = Math.pow(sv.decelerationRate, dt);
                        if (sv.horizontalEnabled && Math.abs(state.velocityX) > 0.1) {
                            sv.scrollX += state.velocityX * dt;
                            state.velocityX *= decay;
                        } else {
                            state.velocityX = 0;
                        }
                        if (sv.verticalEnabled && Math.abs(state.velocityY) > 0.1) {
                            sv.scrollY += state.velocityY * dt;
                            state.velocityY *= decay;
                        } else {
                            state.velocityY = 0;
                        }
                    }

                    const viewW = rect.size.x;
                    const viewH = rect.size.y;
                    const maxScrollX = Math.max(0, sv.contentWidth - viewW);
                    const maxScrollY = Math.max(0, sv.contentHeight - viewH);
                    sv.scrollX = Math.max(0, Math.min(sv.scrollX, maxScrollX));
                    sv.scrollY = Math.max(0, Math.min(sv.scrollY, maxScrollY));

                    if (sv.contentEntity !== 0 && world.valid(sv.contentEntity)) {
                        if (world.has(sv.contentEntity, LocalTransform)) {
                            const lt = world.get(sv.contentEntity, LocalTransform) as LocalTransformData;
                            lt.position.x = -sv.scrollX;
                            lt.position.y = sv.scrollY;
                            world.insert(sv.contentEntity, LocalTransform, lt);
                        }
                    }
                }
            },
            { name: 'ScrollViewSystem' }
        ));
    }
}

export const scrollViewPlugin = new ScrollViewPlugin();
