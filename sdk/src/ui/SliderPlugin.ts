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
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import { applyDirectionalFill } from './uiHelpers';

export class SliderPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Slider', Slider);

        const world = app.world;
        let draggingSlider: Entity | null = null;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo)],
            (input: InputState, camera: UICameraData) => {
                if (!camera.valid) return;

                const worldMouse = { x: camera.worldMouseX, y: camera.worldMouseY };

                const entities = world.getEntitiesWithComponents([Slider, UIRect, WorldTransform]);
                for (const entity of entities) {
                    if (!world.has(entity, Interactable)) {
                        world.insert(entity, Interactable, { enabled: true, blockRaycast: true });
                    }

                    const slider = world.get(entity, Slider) as SliderData;
                    const rect = world.get(entity, UIRect) as UIRectData;
                    const wt = world.get(entity, WorldTransform) as WorldTransformData;
                    const interaction = world.has(entity, UIInteraction)
                        ? world.get(entity, UIInteraction) as UIInteractionData
                        : null;

                    if (interaction?.justPressed) {
                        draggingSlider = entity;
                    }

                    if (draggingSlider === entity && input.isMouseButtonDown(0)) {
                        const worldW = rect.size.x * wt.scale.x;
                        const worldH = rect.size.y * wt.scale.y;
                        const originX = wt.position.x - rect.pivot.x * worldW;
                        const originY = wt.position.y - rect.pivot.y * worldH;

                        let t: number;
                        switch (slider.direction) {
                            case FillDirection.LeftToRight:
                                t = worldW > 0 ? (worldMouse.x - originX) / worldW : 0;
                                break;
                            case FillDirection.RightToLeft:
                                t = worldW > 0 ? 1 - (worldMouse.x - originX) / worldW : 0;
                                break;
                            case FillDirection.BottomToTop:
                                t = worldH > 0 ? (worldMouse.y - originY) / worldH : 0;
                                break;
                            case FillDirection.TopToBottom:
                                t = worldH > 0 ? 1 - (worldMouse.y - originY) / worldH : 0;
                                break;
                        }

                        t = Math.max(0, Math.min(1, t));
                        let newValue = slider.minValue + t * (slider.maxValue - slider.minValue);
                        if (slider.wholeNumbers) {
                            newValue = Math.round(newValue);
                        }
                        slider.value = Math.max(slider.minValue, Math.min(slider.maxValue, newValue));
                    }

                    if (draggingSlider === entity && input.isMouseButtonReleased(0)) {
                        draggingSlider = null;
                    }

                    const range = slider.maxValue - slider.minValue;
                    const normalizedValue = range > 0 ? (slider.value - slider.minValue) / range : 0;

                    if (slider.fillEntity !== 0 && world.valid(slider.fillEntity)) {
                        applyDirectionalFill(world, slider.fillEntity, slider.direction, normalizedValue);
                    }

                    if (slider.handleEntity !== 0 && world.valid(slider.handleEntity)) {
                        if (world.has(slider.handleEntity, UIRect)) {
                            const handleRect = world.get(slider.handleEntity, UIRect) as UIRectData;
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
                    }
                }
            },
            { name: 'SliderSystem' }
        ));
    }
}

export const sliderPlugin = new SliderPlugin();
