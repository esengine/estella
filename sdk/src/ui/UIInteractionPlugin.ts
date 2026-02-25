import type { App, Plugin } from '../app';
import { registerComponent, Transform, Sprite } from '../component';
import type { SpriteData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Input } from '../input';
import type { InputState } from '../input';
import type { Entity } from '../types';
import type { World } from '../world';
import { isEditor, isPlayMode } from '../env';
import { Interactable } from './Interactable';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { Button, ButtonState } from './Button';
import type { ButtonData } from './Button';
import { UIEvents, UIEventQueue } from './UIEvents';
import type { UIEventType } from './UIEvents';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import type { InteractableData } from './Interactable';
import { screenToWorld, createInvVPCache } from './uiMath';
import { platformDevicePixelRatio } from '../platform';
import { applyColorTransition, ensureComponent, walkParentChain } from './uiHelpers';
import type { ESEngineModule, CppRegistry } from '../wasm';

const vpCache = createInvVPCache();

function emitWithBubbling(
    world: World,
    events: UIEventQueue,
    entity: Entity,
    type: UIEventType
): void {
    events.emit(entity, type, entity);

    walkParentChain(world, entity, (ancestor) => {
        if (!world.has(ancestor, Interactable)) return false;
        const interactable = world.get(ancestor, Interactable) as InteractableData;
        if (interactable.enabled) {
            events.emit(ancestor, type, entity);
        }
        return interactable.blockRaycast;
    });
}

export class UIInteractionPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Interactable', Interactable);
        registerComponent('Button', Button);

        const world = app.world;
        const module = app.wasmModule as ESEngineModule;
        const registry = world.getCppRegistry() as CppRegistry;
        const events = new UIEventQueue();
        app.insertResource(UIEvents, events);

        let hoveredEntity: Entity | null = null;
        let pressedEntity: Entity | null = null;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo)],
            (input: InputState, camera: UICameraData) => {
                events.drain();

                if (isEditor() && !isPlayMode()) return;

                const interactionEntities = world.getEntitiesWithComponents([UIInteraction]);
                for (const entity of interactionEntities) {
                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    if (interaction.justPressed || interaction.justReleased) {
                        interaction.justPressed = false;
                        interaction.justReleased = false;
                        world.insert(entity, UIInteraction, interaction);
                    }
                }

                if (!camera.valid) return;

                const dpr = platformDevicePixelRatio();
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

                const mouseDown = input.isMouseButtonDown(0);
                const mousePressed = input.isMouseButtonPressed(0);
                const mouseReleased = input.isMouseButtonReleased(0);

                module.uiHitTest_update(
                    registry,
                    worldMouse.x, worldMouse.y,
                    mouseDown, mousePressed, mouseReleased,
                );

                const hitEntityRaw = module.uiHitTest_getHitEntity();
                const hitEntity: Entity | null = hitEntityRaw === 0xFFFFFFFF ? null : hitEntityRaw;

                if (hoveredEntity !== null && !world.valid(hoveredEntity)) {
                    hoveredEntity = null;
                }

                if (hoveredEntity !== hitEntity) {
                    if (hoveredEntity !== null && world.valid(hoveredEntity) && world.has(hoveredEntity, UIInteraction)) {
                        const prev = world.get(hoveredEntity, UIInteraction) as UIInteractionData;
                        prev.hovered = false;
                        world.insert(hoveredEntity, UIInteraction, prev);
                        events.emit(hoveredEntity, 'hover_exit');
                    }
                    if (hitEntity !== null) {
                        ensureComponent(world, hitEntity, UIInteraction);
                        const curr = world.get(hitEntity, UIInteraction) as UIInteractionData;
                        curr.hovered = true;
                        world.insert(hitEntity, UIInteraction, curr);
                        events.emit(hitEntity, 'hover_enter');
                    }
                    hoveredEntity = hitEntity;
                }

                if (mousePressed && hitEntity !== null) {
                    const interaction = world.get(hitEntity, UIInteraction) as UIInteractionData;
                    interaction.pressed = true;
                    interaction.justPressed = true;
                    world.insert(hitEntity, UIInteraction, interaction);
                    pressedEntity = hitEntity;
                    emitWithBubbling(world, events, hitEntity, 'press');
                }

                if (mouseReleased && pressedEntity !== null) {
                    if (world.valid(pressedEntity) && world.has(pressedEntity, UIInteraction)) {
                        const interaction = world.get(pressedEntity, UIInteraction) as UIInteractionData;
                        interaction.pressed = false;
                        interaction.justReleased = true;
                        world.insert(pressedEntity, UIInteraction, interaction);
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
