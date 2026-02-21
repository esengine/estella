import type { App, Plugin } from '../app';
import { registerComponent, WorldTransform } from '../component';
import type { WorldTransformData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Input } from '../input';
import type { InputState } from '../input';
import type { Entity } from '../types';
import { Slider, FillDirection } from './Slider';
import type { SliderData } from './Slider';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { Interactable } from './Interactable';
import type { InteractableData } from './Interactable';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import { UIEvents, UIEventQueue } from './UIEvents';
import { applyDirectionalFill, getEffectiveWidth, getEffectiveHeight, ensureComponent, layoutChildEntity } from './uiHelpers';
import type { LayoutRect } from './uiLayout';
import { quaternionToAngle2D } from './uiMath';

export class SliderPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Slider', Slider);

        const world = app.world;
        let draggingSlider: Entity | null = null;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo), Res(UIEvents)],
            (input: InputState, camera: UICameraData, events: UIEventQueue) => {
                if (!camera.valid) return;

                if (draggingSlider !== null && !world.valid(draggingSlider)) {
                    draggingSlider = null;
                }

                const worldMouse = { x: camera.worldMouseX, y: camera.worldMouseY };

                const entities = world.getEntitiesWithComponents([Slider, UIRect, WorldTransform]);
                for (const entity of entities) {
                    ensureComponent(world, entity, Interactable, { enabled: true, blockRaycast: true });

                    const slider = world.get(entity, Slider) as SliderData;
                    const rect = world.get(entity, UIRect) as UIRectData;
                    const wt = world.get(entity, WorldTransform) as WorldTransformData;
                    const interaction = world.has(entity, UIInteraction)
                        ? world.get(entity, UIInteraction) as UIInteractionData
                        : null;

                    const handleEntity = slider.handleEntity;
                    if (handleEntity !== 0 && world.valid(handleEntity)) {
                        ensureComponent(world, handleEntity, Interactable, { enabled: true, blockRaycast: false });
                        if (world.has(handleEntity, Interactable)) {
                            const hi = world.get(handleEntity, Interactable) as InteractableData;
                            if (hi.blockRaycast) {
                                hi.blockRaycast = false;
                                world.insert(handleEntity, Interactable, hi);
                            }
                        }
                    }

                    let pressed = interaction?.justPressed ?? false;
                    if (!pressed && handleEntity !== 0 && world.valid(handleEntity) && world.has(handleEntity, UIInteraction)) {
                        const handleInteraction = world.get(handleEntity, UIInteraction) as UIInteractionData;
                        pressed = handleInteraction.justPressed;
                    }

                    if (pressed) {
                        draggingSlider = entity;
                    }

                    if (draggingSlider === entity && input.isMouseButtonDown(0)) {
                        const localW = getEffectiveWidth(rect);
                        const localH = getEffectiveHeight(rect);
                        const worldW = localW * wt.scale.x;
                        const worldH = localH * wt.scale.y;

                        const angle = quaternionToAngle2D(wt.rotation.z, wt.rotation.w);
                        const sin = Math.sin(-angle);
                        const cos = Math.cos(-angle);
                        const dx = worldMouse.x - wt.position.x;
                        const dy = worldMouse.y - wt.position.y;
                        const localMouseX = dx * cos - dy * sin;
                        const localMouseY = dx * sin + dy * cos;

                        const originX = -rect.pivot.x * worldW;
                        const originY = -rect.pivot.y * worldH;

                        let t: number;
                        switch (slider.direction) {
                            case FillDirection.LeftToRight:
                                t = worldW > 0 ? (localMouseX - originX) / worldW : 0;
                                break;
                            case FillDirection.RightToLeft:
                                t = worldW > 0 ? 1 - (localMouseX - originX) / worldW : 0;
                                break;
                            case FillDirection.BottomToTop:
                                t = worldH > 0 ? (localMouseY - originY) / worldH : 0;
                                break;
                            case FillDirection.TopToBottom:
                                t = worldH > 0 ? 1 - (localMouseY - originY) / worldH : 0;
                                break;
                        }

                        t = Math.max(0, Math.min(1, t));
                        let newValue = slider.minValue + t * (slider.maxValue - slider.minValue);
                        if (slider.wholeNumbers) {
                            newValue = Math.round(newValue);
                        }
                        const oldValue = slider.value;
                        slider.value = Math.max(slider.minValue, Math.min(slider.maxValue, newValue));
                        world.insert(entity, Slider, slider);

                        if (slider.value !== oldValue) {
                            events.emit(entity, 'change');
                        }
                    }

                    if (draggingSlider === entity && input.isMouseButtonReleased(0)) {
                        draggingSlider = null;
                    }

                    const range = slider.maxValue - slider.minValue;
                    const normalizedValue = range > 0 ? (slider.value - slider.minValue) / range : 0;
                    const sliderW = getEffectiveWidth(rect);
                    const sliderH = getEffectiveHeight(rect);

                    const sliderPivot = rect.pivot;
                    const sliderParentRect: LayoutRect = {
                        left: -sliderPivot.x * sliderW,
                        bottom: -sliderPivot.y * sliderH,
                        right: (1 - sliderPivot.x) * sliderW,
                        top: (1 - sliderPivot.y) * sliderH,
                    };

                    if (slider.fillEntity !== 0 && world.valid(slider.fillEntity)) {
                        applyDirectionalFill(world, slider.fillEntity, slider.direction, normalizedValue);
                        layoutChildEntity(world, slider.fillEntity, sliderParentRect, 0, 0);
                    }

                    if (slider.handleEntity !== 0 && world.valid(slider.handleEntity)) {
                        if (world.has(slider.handleEntity, UIRect)) {
                            const handleRect = world.get(slider.handleEntity, UIRect) as UIRectData;
                            handleRect.offsetMin = { x: 0, y: 0 };
                            handleRect.offsetMax = { x: 0, y: 0 };
                            switch (slider.direction) {
                                case FillDirection.LeftToRight:
                                    handleRect.anchorMin = { x: normalizedValue, y: 0 };
                                    handleRect.anchorMax = { x: normalizedValue, y: 1 };
                                    break;
                                case FillDirection.RightToLeft:
                                    handleRect.anchorMin = { x: 1 - normalizedValue, y: 0 };
                                    handleRect.anchorMax = { x: 1 - normalizedValue, y: 1 };
                                    break;
                                case FillDirection.BottomToTop:
                                    handleRect.anchorMin = { x: 0, y: normalizedValue };
                                    handleRect.anchorMax = { x: 1, y: normalizedValue };
                                    break;
                                case FillDirection.TopToBottom:
                                    handleRect.anchorMin = { x: 0, y: 1 - normalizedValue };
                                    handleRect.anchorMax = { x: 1, y: 1 - normalizedValue };
                                    break;
                            }
                            world.insert(slider.handleEntity, UIRect, handleRect);
                        }
                        layoutChildEntity(world, slider.handleEntity, sliderParentRect, 0, 0);
                    }
                }
            },
            { name: 'SliderSystem' }
        ), { runAfter: ['UIInteractionSystem'] });
    }
}

export const sliderPlugin = new SliderPlugin();
