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
import { UiPointerBook, uiPointersOf, type UiPointerSample } from './pointerBook';
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

        // The press policy lives in UiPointerBook; this system is its projection
        // onto the world — a raycast per pointer, and the writes its verdicts
        // imply. Gestures (drag, scroll, slider) stay on the primary pointer.
        const book = new UiPointerBook();
        /** Where each pointer last hit, so a settled pointer skips the raycast. */
        const lastHit = new Map<number, { x: number; y: number; entity: Entity | null }>();
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
                const surfaceH = overlay.active ? overlay.surfaceH : camera.screenH;
                const pointers = uiPointersOf(input);
                const layoutChanged = layoutGen.generation !== lastLayoutGen;
                lastLayoutGen = layoutGen.generation;

                // The single-pointer resources every other consumer reads are the
                // PRIMARY pointer's: the mouse, or the oldest finger on the glass.
                let primaryWritten = false;
                let overUI = false;

                const hit = (pointer: UiPointerSample): Entity | null => {
                    const glX = pointer.x * dpr;
                    const glY = surfaceH - pointer.y * dpr;
                    // The pointer, once per domain. Neither is derived from the
                    // other: each is the inverse of the projection that domain is
                    // drawn with, which is what keeps a click where the pixel is.
                    const worldPointer = camera.valid ? screenToUiWorld(camera, glX, glY) : { x: 0, y: 0 };
                    const layoutPointer = overlay.active ? screenToUiLayout(overlay, glX, glY) : worldPointer;
                    if (!primaryWritten) {
                        primaryWritten = true;
                        camera.worldMouseX = worldPointer.x;
                        camera.worldMouseY = worldPointer.y;
                        overlay.pointerX = layoutPointer.x;
                        overlay.pointerY = layoutPointer.y;
                    }
                    const cached = lastHit.get(pointer.id);
                    const edge = pointer.pressed || pointer.released;
                    const settled = cached !== undefined
                        && cached.x === layoutPointer.x && cached.y === layoutPointer.y;
                    let entity: Entity | null;
                    if (settled && !layoutChanged && !edge) {
                        entity = cached.entity !== null && world.valid(cached.entity) ? cached.entity : null;
                    } else {
                        // With no camera there is no world ray: inverting a projection
                        // never written yields NaN, which answers "no" by accident.
                        // The screen's ray stands in — nothing is in the world.
                        const screenRay = overlay.active ? uiLayoutRay(overlay, glX, glY) : undefined;
                        const worldRay = camera.valid ? uiPointerRay(camera, glX, glY) : screenRay!;
                        entity = uiHitTestWorld(world, worldRay, screenRay);
                        lastHit.set(pointer.id, { x: layoutPointer.x, y: layoutPointer.y, entity });
                    }
                    if (entity !== null) overUI = true;
                    return entity;
                };

                const wasPressed = new Set(book.pressed);
                for (const event of book.step(pointers, hit, (e) => world.valid(e))) {
                    switch (event.kind) {
                        case 'hoverEnter':
                            ensureComponent(world, event.entity, UIInteraction);
                            events.emit(event.entity, UIEventType.HoverEnter);
                            break;
                        case 'hoverExit':
                            events.emit(event.entity, UIEventType.HoverExit);
                            break;
                        case 'press':
                            ensureComponent(world, event.entity, UIInteraction);
                            emitWithBubbling(world, events, event.entity, UIEventType.Press);
                            break;
                        case 'release':
                            emitWithBubbling(world, events, event.entity, UIEventType.Release);
                            break;
                        case 'click':
                            emitWithBubbling(world, events, event.entity, UIEventType.Click);
                            break;
                    }
                }

                // `hovered` and `pressed` are facts about the ENTITY: true while
                // any pointer is over or holding it, false once none is.
                const hovered = book.hovered;
                const pressed = book.pressed;
                const touched = new Set<Entity>([...interactionEntities, ...hovered, ...pressed, ...wasPressed]);
                for (const entity of touched) {
                    if (!world.valid(entity) || !world.has(entity, UIInteraction)) continue;
                    const data = world.get(entity, UIInteraction) as UIInteractionData;
                    const isHovered = hovered.has(entity);
                    const isPressed = pressed.has(entity);
                    const justPressed = data.justPressed || (isPressed && !wasPressed.has(entity));
                    const justReleased = data.justReleased || (!isPressed && wasPressed.has(entity));
                    if (data.hovered === isHovered && data.pressed === isPressed
                        && data.justPressed === justPressed && data.justReleased === justReleased) continue;
                    data.hovered = isHovered;
                    data.pressed = isPressed;
                    data.justPressed = justPressed;
                    data.justReleased = justReleased;
                    world.insert(entity, UIInteraction, data);
                }

                // Gameplay reads this (Update) to skip input the UI claimed.
                input.pointerOverUI = overUI;
            },
            { name: 'UIInteractionSystem' }
        ), { runAfter: [SystemLabel.UILayout], runIf: playModeOnly });
    }
}

export const uiInteractionPlugin = new UIInteractionPlugin();
