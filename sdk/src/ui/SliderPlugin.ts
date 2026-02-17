import type { App, Plugin } from '../app';
import { registerComponent, WorldTransform } from '../component';
import type { WorldTransformData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Input } from '../input';
import type { InputState } from '../input';
import type { Entity } from '../types';
import { Slider, SliderDirection } from './Slider';
import type { SliderData } from './Slider';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { Interactable } from './Interactable';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import { invertMatrix4, screenToWorld, pointInOBB } from './uiMath';

export class SliderPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Slider', Slider);

        const world = app.world;
        const invVP = new Float32Array(16);
        const cachedDpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        let draggingSlider: Entity | null = null;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo)],
            (input: InputState, camera: UICameraData) => {
                if (!camera.valid) return;

                const mouseGLX = input.mouseX * cachedDpr;
                const mouseGLY = camera.screenH - input.mouseY * cachedDpr;
                invertMatrix4(camera.viewProjection, invVP);
                const worldMouse = screenToWorld(
                    mouseGLX, mouseGLY, invVP,
                    camera.vpX, camera.vpY, camera.vpW, camera.vpH,
                );

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
                            case SliderDirection.LeftToRight:
                                t = worldW > 0 ? (worldMouse.x - originX) / worldW : 0;
                                break;
                            case SliderDirection.RightToLeft:
                                t = worldW > 0 ? 1 - (worldMouse.x - originX) / worldW : 0;
                                break;
                            case SliderDirection.BottomToTop:
                                t = worldH > 0 ? (worldMouse.y - originY) / worldH : 0;
                                break;
                            case SliderDirection.TopToBottom:
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

                    if (slider.fillEntity !== 0 && world.valid(slider.fillEntity as Entity)) {
                        const fillEntity = slider.fillEntity as Entity;
                        if (world.has(fillEntity, UIRect)) {
                            const fillRect = world.get(fillEntity, UIRect) as UIRectData;
                            switch (slider.direction) {
                                case SliderDirection.LeftToRight:
                                    fillRect.anchorMin = { x: 0, y: 0 };
                                    fillRect.anchorMax = { x: normalizedValue, y: 1 };
                                    break;
                                case SliderDirection.RightToLeft:
                                    fillRect.anchorMin = { x: 1 - normalizedValue, y: 0 };
                                    fillRect.anchorMax = { x: 1, y: 1 };
                                    break;
                                case SliderDirection.BottomToTop:
                                    fillRect.anchorMin = { x: 0, y: 0 };
                                    fillRect.anchorMax = { x: 1, y: normalizedValue };
                                    break;
                                case SliderDirection.TopToBottom:
                                    fillRect.anchorMin = { x: 0, y: 1 - normalizedValue };
                                    fillRect.anchorMax = { x: 1, y: 1 };
                                    break;
                            }
                            world.insert(fillEntity, UIRect, fillRect);
                        }
                    }

                    if (slider.handleEntity !== 0 && world.valid(slider.handleEntity as Entity)) {
                        const handleEntity = slider.handleEntity as Entity;
                        if (world.has(handleEntity, UIRect)) {
                            const handleRect = world.get(handleEntity, UIRect) as UIRectData;
                            switch (slider.direction) {
                                case SliderDirection.LeftToRight:
                                    handleRect.anchorMin = { x: normalizedValue, y: 0 };
                                    handleRect.anchorMax = { x: normalizedValue, y: 1 };
                                    break;
                                case SliderDirection.RightToLeft:
                                    handleRect.anchorMin = { x: 1 - normalizedValue, y: 0 };
                                    handleRect.anchorMax = { x: 1 - normalizedValue, y: 1 };
                                    break;
                                case SliderDirection.BottomToTop:
                                    handleRect.anchorMin = { x: 0, y: normalizedValue };
                                    handleRect.anchorMax = { x: 1, y: normalizedValue };
                                    break;
                                case SliderDirection.TopToBottom:
                                    handleRect.anchorMin = { x: 0, y: 1 - normalizedValue };
                                    handleRect.anchorMax = { x: 1, y: 1 - normalizedValue };
                                    break;
                            }
                            world.insert(handleEntity, UIRect, handleRect);
                        }
                    }
                }
            },
            { name: 'SliderSystem' }
        ));
    }
}

export const sliderPlugin = new SliderPlugin();
