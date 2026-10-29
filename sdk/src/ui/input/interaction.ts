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
import { UiPointerBook, UiPointerHitCache, uiPointersOf, MOUSE_POINTER, type UiPointerSample } from './pointerBook';
import { fireGestureClick, expireGestureFired } from './gestureClick';
import { inputRouter } from '../../input/inputRouter';
import { SystemLabel, PluginName } from '../../ecs/systemLabels';
import type { UILayoutGenerationData } from '../layout/ui-layout-generation';
import { UIControlPointers, type ControlPointer, type UiPointerEventData } from './control-pointers';

function emitWithBubbling(
    world: World,
    events: UIEventQueue,
    entity: Entity,
    type: string,
    data?: UiPointerEventData,
): void {
    const event = events.emit(entity, type, data);
    if (!world.valid(entity)) return;

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

    private readonly releases_ = new WeakMap<App, () => void>();

    cleanup(app?: App): void {
        if (!app) return;
        const release = this.releases_.get(app);
        this.releases_.delete(app);
        release?.();
    }

    build(app: App): void {
        this.cleanup(app);
        registerComponent('Interactable', Interactable);
        registerComponent('UIInteraction', UIInteraction);

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
        const controlPointers = new Map<number, ControlPointer>();
        const lastMoveSent = new Map<number, { x: number; y: number }>();
        /** What a pointer event tells about its pointer, from the position this frame's raycast used. */
        const dataFor = (pointer: number): UiPointerEventData | undefined => {
            const c = controlPointers.get(pointer);
            return c ? { pointer, worldX: c.worldX, worldY: c.worldY, layoutX: c.layoutX, layoutY: c.layoutY, screenX: c.screenX, screenY: c.screenY } : undefined;
        };
        app.insertResource(UIControlPointers, {
            pointers: controlPointers,
            cancelHold: (pointer: number, to?: Entity): void => {
                const held = book.cancelHold(pointer, to);
                if (held === null || !world.valid(held)) return;
                if (world.has(held, UIInteraction)) {
                    world.set(held, UIInteraction, { ...world.get(held, UIInteraction), pressed: false, justReleased: false });
                }
                emitWithBubbling(world, events, held, UIEventType.PressCancel, dataFor(pointer));
                // the new holder hears the moves from here, not from wherever the last holder was told about
                const here = controlPointers.get(pointer);
                if (to !== undefined && here) lastMoveSent.set(pointer, { x: here.worldX, y: here.worldY });
            },
        });
        /** Where each pointer last hit, so a settled pointer skips the raycast. */
        const lastHit = new UiPointerHitCache();
        const offExecution = app.onExecutionChange(held => {
            if (!held) return;
            book.clear(); controlPointers.clear(); lastHit.clear(); expireGestureFired(world);
        });
        let lastLayoutGen = -1;
        let lastWorldVersion = -1;
        let lastTick = -1;
        world.enableChangeTracking(Interactable);
        const eligible = (entity: Entity): boolean => world.isEntityActive(entity)
            && (!world.has(entity, Interactable) || world.get(entity, Interactable).enabled);

        // During the host's release event, from what the last frame saw: the
        // control this pointer pressed, if it is still the one under it.
        const releaseInGesture = (pointer: number): void => {
            if (app.isExecutionHeld()) return;
            const held = book.releasing(pointer, lastHit.get(pointer)?.entity ?? null);
            if (held === null || !eligible(held)) return;
            if (world.has(held, Interactable) && !(world.get(held, Interactable) as InteractableData).enabled) return;
            fireGestureClick(world, held);
        };
        const unregister = inputRouter.setUIHandler({
            onTouchEnd: (id) => { releaseInGesture(id); },
            onPointerUp: (button) => { if (button === 0) releaseInGesture(MOUSE_POINTER); },
        });
        this.releases_.set(app, () => {
            offExecution();
            unregister();
            book.clear();
            controlPointers.clear();
            lastHit.clear();
            expireGestureFired(world);
        });

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
                        world.set(entity, UIInteraction, interaction);
                    }
                }

                // Either domain is enough to be pointing AT something: a scene
                // with no camera still has a screen, and a HUD on it is still
                // clickable.
                const dpr = platformDevicePixelRatio();
                const surfaceH = overlay.active ? overlay.surfaceH : camera.screenH;
                const pointers = uiPointersOf(input);
                controlPointers.clear();
                lastHit.retain(pointers);
                const layoutChanged = layoutGen.generation !== lastLayoutGen;
                lastLayoutGen = layoutGen.generation;
                const worldVersion = world.getWorldVersion();
                // A write between frames may carry the previous frame's tick;
                // overlap one tick so stationary pointers see enable/disable.
                const worldChanged = worldVersion !== lastWorldVersion
                    || world.anyChangedSince(Interactable, lastTick - 1);
                lastWorldVersion = worldVersion;
                lastTick = world.getWorldTick();

                // The single-pointer resources every other consumer reads are the
                // PRIMARY pointer's: the mouse, or the oldest finger on the glass.
                let primaryWritten = false;
                const hasHeldPointer = pointers.some(pointer => pointer.down);
                let overUI = false;

                const hit = (pointer: UiPointerSample): Entity | null => {
                    if (!camera.valid && !overlay.active) return null;
                    const glX = pointer.x * dpr;
                    const glY = surfaceH - pointer.y * dpr;
                    // The pointer, once per domain. Neither is derived from the
                    // other: each is the inverse of the projection that domain is
                    // drawn with, which is what keeps a click where the pixel is.
                    const worldPointer = camera.valid ? screenToUiWorld(camera, glX, glY) : { x: 0, y: 0 };
                    const layoutPointer = overlay.active ? screenToUiLayout(overlay, glX, glY) : worldPointer;
                    controlPointers.set(pointer.id, { id: pointer.id, down: pointer.down, pressed: pointer.pressed,
                        entity: null, pressedEntity: null, layoutX: layoutPointer.x, layoutY: layoutPointer.y,
                        worldX: worldPointer.x, worldY: worldPointer.y, screenX: glX, screenY: glY });
                    if (!primaryWritten && (pointer.down || !hasHeldPointer)) {
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
                    if (settled && !layoutChanged && !worldChanged && !edge
                        && (cached.entity === null || eligible(cached.entity))) {
                        entity = cached.entity;
                    } else {
                        // With no camera there is no world ray: inverting a projection
                        // never written yields NaN, which answers "no" by accident.
                        // The screen's ray stands in — nothing is in the world.
                        const screenRay = overlay.active ? uiLayoutRay(overlay, glX, glY) : undefined;
                        const worldRay = camera.valid ? uiPointerRay(camera, glX, glY) : screenRay!;
                        entity = uiHitTestWorld(world, worldRay, screenRay);
                        if (entity !== null && !eligible(entity)) entity = null;
                        lastHit.set(pointer.id, { x: layoutPointer.x, y: layoutPointer.y, entity });
                    }
                    if (entity !== null) overUI = true;
                    return entity;
                };

                const wasPressed = new Set(book.pressed);
                const wasHovered = new Set(book.hovered);
                const active = (entity: Entity): boolean => eligible(entity) && (camera.valid || overlay.active);
                const pointerEvents = book.step(pointers, hit, active);
                for (const event of pointerEvents) {
                    // Earlier events in this batch can disable or remove a later target.
                    if (!active(event.entity)) continue;
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
                            // A complete click may arrive between frames. Preserve its
                            // edge even when the final held-state is already false.
                            world.set(event.entity, UIInteraction, { ...world.get(event.entity, UIInteraction), justPressed: true });
                            emitWithBubbling(world, events, event.entity, UIEventType.Press, dataFor(event.pointer));
                            break;
                        case 'release':
                            if (world.has(event.entity, UIInteraction))
                                world.set(event.entity, UIInteraction, { ...world.get(event.entity, UIInteraction), justReleased: true });
                            emitWithBubbling(world, events, event.entity, UIEventType.Release, dataFor(event.pointer));
                            break;
                        case 'click':
                            emitWithBubbling(world, events, event.entity, UIEventType.Click, dataFor(event.pointer));
                            break;
                    }
                }
                // A pointer holding an entity that moved: the holder hears it (and its ancestors), with where.
                for (const [id, entity] of book.cancelledHolds) {
                    lastMoveSent.delete(id);
                    if (active(entity)) emitWithBubbling(world, events, entity, UIEventType.PressCancel, dataFor(id));
                }
                for (const pointer of pointers) {
                    const held = pointer.down ? book.heldBy(pointer.id) : null;
                    const c = controlPointers.get(pointer.id);
                    if (held === null || !c) { lastMoveSent.delete(pointer.id); continue; }
                    const before = lastMoveSent.get(pointer.id);
                    lastMoveSent.set(pointer.id, { x: c.worldX, y: c.worldY });
                    if (pointer.pressed || !before || (before.x === c.worldX && before.y === c.worldY)) continue;
                    if (active(held)) emitWithBubbling(world, events, held, UIEventType.PointerMove, dataFor(pointer.id));
                }
                book.prune(active);
                for (const pointer of controlPointers.values()) pointer.entity = book.heldBy(pointer.id);
                for (const event of pointerEvents) if (event.kind === 'press') {
                    const pointer = controlPointers.get(event.pointer);
                    if (pointer) pointer.pressedEntity = event.entity;
                }

                // `hovered` and `pressed` are facts about the ENTITY: true while
                // any pointer is over or holding it, false once none is.
                const hovered = book.hovered;
                const pressed = book.pressed;
                const touched = new Set<Entity>([...interactionEntities, ...hovered, ...pressed, ...wasPressed, ...wasHovered]);
                for (const event of pointerEvents) touched.add(event.entity);
                for (const entity of touched) {
                    if (!world.valid(entity) || !world.has(entity, UIInteraction)) continue;
                    const data = world.get(entity, UIInteraction) as UIInteractionData;
                    const isActive = active(entity);
                    const isHovered = isActive && hovered.has(entity);
                    const isPressed = isActive && pressed.has(entity);
                    const justPressed = isActive && (data.justPressed || (isPressed && !wasPressed.has(entity)));
                    const justReleased = isActive && (data.justReleased
                        || (!isPressed && wasPressed.has(entity) && !book.cancelled.has(entity)));
                    if (data.hovered === isHovered && data.pressed === isPressed
                        && data.justPressed === justPressed && data.justReleased === justReleased) continue;
                    data.hovered = isHovered;
                    data.pressed = isPressed;
                    data.justPressed = justPressed;
                    data.justReleased = justReleased;
                    world.set(entity, UIInteraction, data);
                }

                // Gameplay reads this (Update) to skip input the UI claimed.
                input.pointerOverUI = overUI && pointers.some(pointer => {
                    const entity = lastHit.get(pointer.id)?.entity;
                    return entity != null && active(entity);
                });
                expireGestureFired(world);
            },
            { name: 'UIInteractionSystem' }
        ), { runAfter: [SystemLabel.UILayout], runIf: playModeOnly });
    }
}

export const uiInteractionPlugin = new UIInteractionPlugin();
