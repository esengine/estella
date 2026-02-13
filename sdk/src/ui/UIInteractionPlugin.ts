import type { App, Plugin } from '../app';
import { WorldTransform, Sprite } from '../component';
import type { WorldTransformData, SpriteData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Input } from '../input';
import type { InputState } from '../input';
import type { Entity } from '../types';
import type { World } from '../world';
import { Interactable } from './Interactable';
import type { InteractableData } from './Interactable';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { Button, ButtonState } from './Button';
import type { ButtonData } from './Button';
import { UIEvents, UIEventQueue } from './UIEvents';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import { invertMatrix4, screenToWorld, pointInWorldRect } from './uiMath';

const _invVP = new Float32Array(16);

export class UIInteractionPlugin implements Plugin {
    build(app: App): void {
        const world = app.world;
        const events = new UIEventQueue();
        app.insertResource(UIEvents, events);

        let hoveredEntity: Entity | null = null;
        let pressedEntity: Entity | null = null;

        // -----------------------------------------------------------------
        // PreUpdate: Hit Testing & Interaction State
        // -----------------------------------------------------------------
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo)],
            (input: InputState, camera: UICameraData) => {
                events.drain();

                const interactionEntities = world.getEntitiesWithComponents([UIInteraction]);
                for (const entity of interactionEntities) {
                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    interaction.justPressed = false;
                    interaction.justReleased = false;
                }

                if (!camera.valid) return;

                const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
                const mouseGLX = input.mouseX * dpr;
                const mouseGLY = camera.screenH - input.mouseY * dpr;

                invertMatrix4(camera.viewProjection, _invVP);
                const worldMouse = screenToWorld(
                    mouseGLX, mouseGLY, _invVP,
                    camera.vpX, camera.vpY, camera.vpW, camera.vpH,
                );

                const interactableEntities = world.getEntitiesWithComponents(
                    [Interactable, UIRect, WorldTransform]
                );

                let hitEntity: Entity | null = null;
                let hitLayer = -Infinity;

                for (const entity of interactableEntities) {
                    if (!world.has(entity, UIInteraction)) {
                        world.insert(entity, UIInteraction);
                    }

                    const interactable = world.get(entity, Interactable) as InteractableData;
                    if (!interactable.enabled) continue;

                    const wt = world.get(entity, WorldTransform) as WorldTransformData;
                    const rect = world.get(entity, UIRect) as UIRectData;
                    const worldW = rect.size.x * wt.scale.x;
                    const worldH = rect.size.y * wt.scale.y;

                    if (pointInWorldRect(
                        worldMouse.x, worldMouse.y,
                        wt.position.x, wt.position.y,
                        worldW, worldH,
                        rect.pivot.x, rect.pivot.y,
                    )) {
                        let layer = 0;
                        if (world.has(entity, Sprite)) {
                            layer = (world.get(entity, Sprite) as SpriteData).layer;
                        }
                        if (layer >= hitLayer) {
                            hitLayer = layer;
                            hitEntity = entity;
                        }
                    }
                }

                if (hoveredEntity !== hitEntity) {
                    if (hoveredEntity !== null && world.valid(hoveredEntity) && world.has(hoveredEntity, UIInteraction)) {
                        const prev = world.get(hoveredEntity, UIInteraction) as UIInteractionData;
                        prev.hovered = false;
                        events.emit(hoveredEntity, 'hover_exit');
                    }
                    if (hitEntity !== null) {
                        const curr = world.get(hitEntity, UIInteraction) as UIInteractionData;
                        curr.hovered = true;
                        events.emit(hitEntity, 'hover_enter');
                    }
                    hoveredEntity = hitEntity;
                }

                if (input.isMouseButtonPressed(0) && hitEntity !== null) {
                    const interaction = world.get(hitEntity, UIInteraction) as UIInteractionData;
                    interaction.pressed = true;
                    interaction.justPressed = true;
                    pressedEntity = hitEntity;
                    events.emit(hitEntity, 'press');
                }

                if (input.isMouseButtonReleased(0) && pressedEntity !== null) {
                    if (world.valid(pressedEntity) && world.has(pressedEntity, UIInteraction)) {
                        const interaction = world.get(pressedEntity, UIInteraction) as UIInteractionData;
                        interaction.pressed = false;
                        interaction.justReleased = true;
                        events.emit(pressedEntity, 'release');
                        if (pressedEntity === hoveredEntity) {
                            events.emit(pressedEntity, 'click');
                        }
                    }
                    pressedEntity = null;
                }
            },
            { name: 'UIInteractionSystem' }
        ));

        // -----------------------------------------------------------------
        // Update: Button State
        // -----------------------------------------------------------------
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [],
            () => {
                const buttonEntities = world.getEntitiesWithComponents([Button]);
                for (const entity of buttonEntities) {
                    if (!world.has(entity, Interactable)) {
                        world.insert(entity, Interactable, { enabled: true });
                    }
                    if (!world.has(entity, UIInteraction)) continue;

                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    const button = world.get(entity, Button) as ButtonData;
                    const interactable = world.get(entity, Interactable) as InteractableData;

                    const prevState = button.state;

                    if (!interactable.enabled) {
                        button.state = ButtonState.Disabled;
                    } else if (interaction.pressed) {
                        button.state = ButtonState.Pressed;
                    } else if (interaction.hovered) {
                        button.state = ButtonState.Hovered;
                    } else {
                        button.state = ButtonState.Normal;
                    }

                    if (prevState !== button.state && button.transition && world.has(entity, Sprite)) {
                        const sprite = world.get(entity, Sprite) as SpriteData;
                        const t = button.transition;
                        switch (button.state) {
                            case ButtonState.Normal: sprite.color = { ...t.normalColor }; break;
                            case ButtonState.Hovered: sprite.color = { ...t.hoveredColor }; break;
                            case ButtonState.Pressed: sprite.color = { ...t.pressedColor }; break;
                            case ButtonState.Disabled: sprite.color = { ...t.disabledColor }; break;
                        }
                        world.insert(entity, Sprite, sprite);
                    }
                }
            },
            { name: 'ButtonSystem' }
        ));
    }
}

export const uiInteractionPlugin = new UIInteractionPlugin();
