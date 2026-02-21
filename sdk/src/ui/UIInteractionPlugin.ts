import type { App, Plugin } from '../app';
import { registerComponent, WorldTransform, Sprite, Parent } from '../component';
import type { WorldTransformData, SpriteData, ParentData } from '../component';
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
import type { UIEventType } from './UIEvents';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import { UIMask } from './UIMask';
import type { UIMaskData } from './UIMask';
import { screenToWorld, pointInOBB, createInvVPCache } from './uiMath';
import { applyColorTransition, getEffectiveWidth, getEffectiveHeight, ensureComponent } from './uiHelpers';

const vpCache = createInvVPCache();

function isClippedByMask(
    world: World,
    entity: Entity,
    worldMouseX: number,
    worldMouseY: number,
): boolean {
    let current = entity;
    while (world.has(current, Parent)) {
        const parentData = world.get(current, Parent) as ParentData;
        const parentEntity = parentData.entity;
        if (!world.valid(parentEntity)) break;

        if (world.has(parentEntity, UIMask)) {
            const mask = world.get(parentEntity, UIMask) as UIMaskData;
            if (mask.enabled && world.has(parentEntity, UIRect) && world.has(parentEntity, WorldTransform)) {
                const wt = world.get(parentEntity, WorldTransform) as WorldTransformData;
                const rect = world.get(parentEntity, UIRect) as UIRectData;
                const maskW = getEffectiveWidth(rect) * wt.scale.x;
                const maskH = getEffectiveHeight(rect) * wt.scale.y;
                if (!pointInOBB(
                    worldMouseX, worldMouseY,
                    wt.position.x, wt.position.y,
                    maskW, maskH,
                    rect.pivot.x, rect.pivot.y,
                    wt.rotation.z, wt.rotation.w,
                )) {
                    return true;
                }
            }
        }
        current = parentEntity;
    }
    return false;
}

function emitWithBubbling(
    world: World,
    events: UIEventQueue,
    entity: Entity,
    type: UIEventType
): void {
    events.emit(entity, type, entity);

    let current = entity;
    while (world.has(current, Parent)) {
        const parentData = world.get(current, Parent) as ParentData;
        const parentEntity = parentData.entity;
        if (!world.valid(parentEntity)) break;
        if (!world.has(parentEntity, Interactable)) {
            current = parentEntity;
            continue;
        }
        const interactable = world.get(parentEntity, Interactable) as InteractableData;
        if (interactable.enabled) {
            events.emit(parentEntity, type, entity);
        }
        if (interactable.blockRaycast) break;
        current = parentEntity;
    }
}

export class UIInteractionPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Interactable', Interactable);
        registerComponent('Button', Button);

        const world = app.world;
        const events = new UIEventQueue();
        app.insertResource(UIEvents, events);

        let hoveredEntity: Entity | null = null;
        let pressedEntity: Entity | null = null;

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

                vpCache.update(camera.viewProjection);
                const invVP = vpCache.getInverse(camera.viewProjection);
                const worldMouse = screenToWorld(
                    mouseGLX, mouseGLY, invVP,
                    camera.vpX, camera.vpY, camera.vpW, camera.vpH,
                );

                camera.worldMouseX = worldMouse.x;
                camera.worldMouseY = worldMouse.y;

                const interactableEntities = world.getEntitiesWithComponents(
                    [Interactable, UIRect, WorldTransform]
                );

                let hitEntity: Entity | null = null;
                let hitLayer = -Infinity;

                for (const entity of interactableEntities) {
                    ensureComponent(world, entity, UIInteraction);

                    const interactable = world.get(entity, Interactable) as InteractableData;
                    if (!interactable.enabled) continue;
                    if (!interactable.raycastTarget) continue;

                    const wt = world.get(entity, WorldTransform) as WorldTransformData;
                    const rect = world.get(entity, UIRect) as UIRectData;
                    const worldW = getEffectiveWidth(rect) * wt.scale.x;
                    const worldH = getEffectiveHeight(rect) * wt.scale.y;

                    if (pointInOBB(
                        worldMouse.x, worldMouse.y,
                        wt.position.x, wt.position.y,
                        worldW, worldH,
                        rect.pivot.x, rect.pivot.y,
                        wt.rotation.z, wt.rotation.w,
                    )) {
                        if (isClippedByMask(world, entity, worldMouse.x, worldMouse.y)) {
                            continue;
                        }

                        let layer = 0;
                        if (world.has(entity, Sprite)) {
                            layer = (world.get(entity, Sprite) as SpriteData).layer;
                        }
                        if (layer > hitLayer) {
                            hitLayer = layer;
                            hitEntity = entity;
                        }
                    }
                }

                if (hoveredEntity !== null && !world.valid(hoveredEntity)) {
                    hoveredEntity = null;
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
                    emitWithBubbling(world, events, hitEntity, 'press');
                }

                if (input.isMouseButtonReleased(0) && pressedEntity !== null) {
                    if (world.valid(pressedEntity) && world.has(pressedEntity, UIInteraction)) {
                        const interaction = world.get(pressedEntity, UIInteraction) as UIInteractionData;
                        interaction.pressed = false;
                        interaction.justReleased = true;
                        emitWithBubbling(world, events, pressedEntity, 'release');
                        if (pressedEntity === hoveredEntity) {
                            emitWithBubbling(world, events, pressedEntity, 'click');
                        }
                    }
                    pressedEntity = null;
                }
            },
            { name: 'UIInteractionSystem' }
        ));

        const buttonInitialized = new Set<Entity>();

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [],
            () => {
                const buttonEntities = world.getEntitiesWithComponents([Button]);
                for (const entity of buttonEntities) {
                    ensureComponent(world, entity, Interactable, { enabled: true });
                    if (!world.has(entity, UIInteraction)) continue;

                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    const button = world.get(entity, Button) as ButtonData;
                    const interactable = world.get(entity, Interactable) as InteractableData;

                    const isFirstFrame = !buttonInitialized.has(entity);
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

                    if (isFirstFrame) {
                        buttonInitialized.add(entity);
                    }

                    if ((isFirstFrame || prevState !== button.state) && button.transition && world.has(entity, Sprite)) {
                        const sprite = world.get(entity, Sprite) as SpriteData;
                        sprite.color = applyColorTransition(
                            button.transition,
                            interactable.enabled,
                            interaction.pressed,
                            interaction.hovered,
                        );
                        world.insert(entity, Sprite, sprite);
                    }
                }
            },
            { name: 'ButtonSystem' }
        ));
    }
}

export const uiInteractionPlugin = new UIInteractionPlugin();
