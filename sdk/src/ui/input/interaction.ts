// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app/app';
import { registerComponent, Transform } from '../../ecs/component';
import { defineSystem, Schedule } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { Input } from '../../input/input';
import type { InputState } from '../../input/input';
import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import { playModeOnly } from '../../ecs/env';
import { Interactable } from './interactable';
import { UIInteraction } from './interactable';
import type { UIInteractionData } from './interactable';
import { UIEventQueue, UIEventType } from '../core/events';
import { ensureEntityEvents } from '../../ecs/entityEvents';
import { UICameraInfo } from '../core/ui-camera-info';
import type { UICameraData } from '../core/ui-camera-info';
import type { InteractableData } from './interactable';
import { screenToUiWorld, screenToUiLayout, uiPointerRay, uiLayoutRay, uiHitTestWorld } from '../util/ui-pick';
import { ScreenOverlay, type ScreenOverlayData } from '../core/screen-overlay';
import { platformDevicePixelRatio } from '../../platform';
import { ensureComponent, walkParentChain } from '../util/helpers';
import type { CppRegistry } from '../../wasm';
import { engineApi } from '../../ecs/bridge/engineApi';
import { UILayoutGeneration } from '../layout/ui-layout-generation';
import { SystemLabel, PluginName } from '../../ecs/systemLabels';
import type { UILayoutGenerationData } from '../layout/ui-layout-generation';

function emitWithBubbling(
    world: World,
    events: UIEventQueue,
    entity: Entity,
    type: string,
): void {
    const event = events.emit(entity, type);

    walkParentChain(world, entity, (ancestor) => {
        if (event.propagationStopped) return true;
        if (!world.has(ancestor, Interactable)) return false;
        const interactable = world.get(ancestor, Interactable) as InteractableData;
        if (interactable.enabled) {
            events.emitBubbled(ancestor, event);
        }
        return interactable.blockRaycast;
    });
}

export class UIInteractionPlugin implements Plugin {
    name = PluginName.UIInteraction;
    dependencies = [PluginName.UILayout];

    build(app: App): void {
        registerComponent('Interactable', Interactable);

        const world = app.world;
        const engine = engineApi(app);
        const registry = world.getCppRegistry() as CppRegistry;
        // The app's one entity-event queue (created on first ask, despawn cleanup
        // included) — shared with every other producer, not owned by the UI.
        const events = ensureEntityEvents(app);

        let hoveredEntity: Entity | null = null;
        let pressedEntity: Entity | null = null;
        let lastPointerX = NaN;
        let lastPointerY = NaN;
        let lastWorldPointerX = NaN;
        let lastWorldPointerY = NaN;
        let lastLayoutGen = -1;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo), Res(ScreenOverlay), Res(UILayoutGeneration)],
            (input: InputState, camera: UICameraData, overlay: ScreenOverlayData,
             layoutGen: UILayoutGenerationData) => {
                events.drain();

                const interactionEntities = world.getEntitiesWithComponents([UIInteraction]);
                for (const entity of interactionEntities) {
                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    if (interaction.justPressed || interaction.justReleased) {
                        interaction.justPressed = false;
                        interaction.justReleased = false;
                        world.insert(entity, UIInteraction, interaction);
                    }
                }

                // Either domain is enough to be pointing AT something: a scene
                // with no camera still has a screen, and a HUD on it is still
                // clickable.
                if (!camera.valid && !overlay.active) { input.pointerOverUI = false; return; }

                const dpr = platformDevicePixelRatio();
                const mouseGLX = input.mouseX * dpr;
                const surfaceH = overlay.active ? overlay.surfaceH : camera.screenH;
                const mouseGLY = surfaceH - input.mouseY * dpr;

                // The pointer, once per domain. Neither is derived from the
                // other: each is the inverse of the projection that domain is
                // drawn with, which is what keeps a click where the pixel is.
                const worldMouse = camera.valid
                    ? screenToUiWorld(camera, mouseGLX, mouseGLY)
                    : { x: 0, y: 0 };
                camera.worldMouseX = worldMouse.x;
                camera.worldMouseY = worldMouse.y;

                const layoutMouse = overlay.active
                    ? screenToUiLayout(overlay, mouseGLX, mouseGLY)
                    : worldMouse;
                overlay.pointerX = layoutMouse.x;
                overlay.pointerY = layoutMouse.y;

                const mouseDown = input.isMouseButtonDown(0);
                const mousePressed = input.isMouseButtonPressed(0);
                const mouseReleased = input.isMouseButtonReleased(0);

                const pointerMoved = layoutMouse.x !== lastPointerX || layoutMouse.y !== lastPointerY
                                  || worldMouse.x !== lastWorldPointerX
                                  || worldMouse.y !== lastWorldPointerY;
                const layoutChanged = layoutGen.generation !== lastLayoutGen;
                const hasMouseEvent = mousePressed || mouseReleased;
                const needsHitTest = pointerMoved || layoutChanged || hasMouseEvent;

                lastPointerX = layoutMouse.x;
                lastPointerY = layoutMouse.y;
                lastWorldPointerX = worldMouse.x;
                lastWorldPointerY = worldMouse.y;
                lastLayoutGen = layoutGen.generation;

                let hitEntity: Entity | null = hoveredEntity;
                if (needsHitTest) {
                    // With no camera there is no world ray: inverting a projection
                    // never written yields NaN, which answers "no" by accident.
                    // The screen's ray stands in — nothing is in the world.
                    const screenRay = overlay.active
                        ? uiLayoutRay(overlay, mouseGLX, mouseGLY) : undefined;
                    const worldRay = camera.valid
                        ? uiPointerRay(camera, mouseGLX, mouseGLY)
                        : screenRay!;
                    hitEntity = uiHitTestWorld(world, worldRay, screenRay);
                }

                if (hoveredEntity !== null && !world.valid(hoveredEntity)) {
                    hoveredEntity = null;
                }

                // Gameplay reads this (Update) to skip input the UI claimed.
                input.pointerOverUI = hitEntity !== null;

                if (hoveredEntity !== hitEntity) {
                    if (hoveredEntity !== null && world.valid(hoveredEntity) && world.has(hoveredEntity, UIInteraction)) {
                        const prev = world.get(hoveredEntity, UIInteraction) as UIInteractionData;
                        prev.hovered = false;
                        world.insert(hoveredEntity, UIInteraction, prev);
                        events.emit(hoveredEntity, UIEventType.HoverExit);
                    }
                    if (hitEntity !== null) {
                        ensureComponent(world, hitEntity, UIInteraction);
                        const curr = world.get(hitEntity, UIInteraction) as UIInteractionData;
                        curr.hovered = true;
                        world.insert(hitEntity, UIInteraction, curr);
                        events.emit(hitEntity, UIEventType.HoverEnter);
                    }
                    hoveredEntity = hitEntity;
                }

                if (mousePressed && hitEntity !== null) {
                    const interaction = world.get(hitEntity, UIInteraction) as UIInteractionData;
                    interaction.pressed = true;
                    interaction.justPressed = true;
                    world.insert(hitEntity, UIInteraction, interaction);
                    pressedEntity = hitEntity;
                    emitWithBubbling(world, events, hitEntity, UIEventType.Press);
                }

                if (mouseReleased && pressedEntity !== null) {
                    if (world.valid(pressedEntity) && world.has(pressedEntity, UIInteraction)) {
                        const interaction = world.get(pressedEntity, UIInteraction) as UIInteractionData;
                        interaction.pressed = false;
                        interaction.justReleased = true;
                        world.insert(pressedEntity, UIInteraction, interaction);
                        emitWithBubbling(world, events, pressedEntity, UIEventType.Release);
                        if (pressedEntity === hoveredEntity) {
                            emitWithBubbling(world, events, pressedEntity, UIEventType.Click);
                        }
                    }
                    pressedEntity = null;
                }
            },
            { name: 'UIInteractionSystem' }
        ), { runAfter: [SystemLabel.UILayout], runIf: playModeOnly });
    }
}

export const uiInteractionPlugin = new UIInteractionPlugin();
