import type { App, Plugin } from '../app';
import { registerComponent, Transform } from '../component';
import type { TransformData } from '../component';
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
import { UIEvents, UIEventQueue } from './UIEvents';
import { isEditor, isPlayMode } from '../env';
import { applyDirectionalFill, getEffectiveWidth, getEffectiveHeight, ensureComponent, layoutChildEntity, type LayoutRect } from './uiHelpers';
import { quaternionToAngle2D } from './uiMath';

function computeSliderValue(
    worldMouseX: number, worldMouseY: number,
    wt: TransformData, rect: UIRectData, entity: Entity,
    direction: FillDirection,
): number {
    const worldW = getEffectiveWidth(rect, entity) * wt.worldScale.x;
    const worldH = getEffectiveHeight(rect, entity) * wt.worldScale.y;

    const angle = quaternionToAngle2D(wt.worldRotation.z, wt.worldRotation.w);
    const sin = Math.sin(-angle);
    const cos = Math.cos(-angle);
    const dx = worldMouseX - wt.worldPosition.x;
    const dy = worldMouseY - wt.worldPosition.y;
    const localMouseX = dx * cos - dy * sin;
    const localMouseY = dx * sin + dy * cos;

    const originX = -rect.pivot.x * worldW;
    const originY = -rect.pivot.y * worldH;

    switch (direction) {
        case FillDirection.LeftToRight:
            return worldW > 0 ? (localMouseX - originX) / worldW : 0;
        case FillDirection.RightToLeft:
            return worldW > 0 ? 1 - (localMouseX - originX) / worldW : 0;
        case FillDirection.BottomToTop:
            return worldH > 0 ? (localMouseY - originY) / worldH : 0;
        case FillDirection.TopToBottom:
            return worldH > 0 ? 1 - (localMouseY - originY) / worldH : 0;
    }
}

function syncHandleRect(
    handleRect: UIRectData,
    direction: FillDirection,
    normalizedValue: number,
): void {
    handleRect.offsetMin.x = 0; handleRect.offsetMin.y = 0;
    handleRect.offsetMax.x = 0; handleRect.offsetMax.y = 0;
    switch (direction) {
        case FillDirection.LeftToRight:
            handleRect.anchorMin.x = normalizedValue; handleRect.anchorMin.y = 0.5;
            handleRect.anchorMax.x = normalizedValue; handleRect.anchorMax.y = 0.5;
            break;
        case FillDirection.RightToLeft:
            handleRect.anchorMin.x = 1 - normalizedValue; handleRect.anchorMin.y = 0.5;
            handleRect.anchorMax.x = 1 - normalizedValue; handleRect.anchorMax.y = 0.5;
            break;
        case FillDirection.BottomToTop:
            handleRect.anchorMin.x = 0.5; handleRect.anchorMin.y = normalizedValue;
            handleRect.anchorMax.x = 0.5; handleRect.anchorMax.y = normalizedValue;
            break;
        case FillDirection.TopToBottom:
            handleRect.anchorMin.x = 0.5; handleRect.anchorMin.y = 1 - normalizedValue;
            handleRect.anchorMax.x = 0.5; handleRect.anchorMax.y = 1 - normalizedValue;
            break;
    }
}

export class SliderPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Slider', Slider);

        const world = app.world;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo), Res(UIEvents)],
            (input: InputState, camera: UICameraData, events: UIEventQueue) => {
                if (!camera.valid) return;

                const entities = world.getEntitiesWithComponents([Slider, UIRect]);
                for (const entity of entities) {
                    const slider = world.get(entity, Slider) as SliderData;
                    const rect = world.get(entity, UIRect) as UIRectData;

                    if (!isEditor() || isPlayMode()) {
                        const hasWT = world.has(entity, Transform);
                        if (hasWT) {
                            ensureComponent(world, entity, Interactable, { enabled: true, blockRaycast: true });
                            if (slider.handleEntity !== 0 && world.valid(slider.handleEntity)) {
                                ensureComponent(world, slider.handleEntity, Interactable, { enabled: true, blockRaycast: false });
                            }

                            const wt = world.get(entity, Transform) as TransformData;

                            let isDragging = false;
                            if (world.has(entity, UIInteraction)) {
                                isDragging = (world.get(entity, UIInteraction) as UIInteractionData).pressed;
                            }
                            if (!isDragging && slider.handleEntity !== 0 && world.valid(slider.handleEntity) && world.has(slider.handleEntity, UIInteraction)) {
                                isDragging = (world.get(slider.handleEntity, UIInteraction) as UIInteractionData).pressed;
                            }

                            if (isDragging && input.isMouseButtonDown(0)) {
                                let t = computeSliderValue(
                                    camera.worldMouseX, camera.worldMouseY,
                                    wt, rect, entity, slider.direction,
                                );
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

                        }
                    }

                    const range = slider.maxValue - slider.minValue;
                    const normalizedValue = range > 0 ? (slider.value - slider.minValue) / range : 0;

                    const sw = getEffectiveWidth(rect, entity);
                    const sh = getEffectiveHeight(rect, entity);
                    const parentRect: LayoutRect = {
                        left: -sw / 2, bottom: -sh / 2,
                        right: sw / 2, top: sh / 2,
                    };

                    if (slider.fillEntity !== 0 && world.valid(slider.fillEntity)) {
                        applyDirectionalFill(world, slider.fillEntity, slider.direction, normalizedValue);
                        layoutChildEntity(world, slider.fillEntity, parentRect, 0, 0);
                    }

                    if (slider.handleEntity !== 0 && world.valid(slider.handleEntity) && world.has(slider.handleEntity, UIRect)) {
                        const handleRect = world.get(slider.handleEntity, UIRect) as UIRectData;
                        syncHandleRect(handleRect, slider.direction, normalizedValue);
                        world.insert(slider.handleEntity, UIRect, handleRect);
                        layoutChildEntity(world, slider.handleEntity, parentRect, 0, 0);
                    }
                }
            },
            { name: 'SliderSystem' }
        ), { runAfter: ['UIInteractionSystem'] });
    }
}

export const sliderPlugin = new SliderPlugin();
