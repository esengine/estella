// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app';
import { Res, Time, type TimeData } from '../../resource';
import { defineSystem, Schedule } from '../../system';
import { Input, type InputState } from '../../input';
import { Transform, type TransformData } from '../../component';
import { playModeOnly } from '../../env';
import type { Entity, Vec2 } from '../../types';

import { UIEvents, UIEventQueue } from '../core/events';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { PluginName, SystemLabel } from '../../systemLabels';
import { ListView, ListViewRegistry } from '../collection/list-view';
import { ScrollContainer, ScrollContainerRegistry } from '../collection/scroll-container';
import { KineticScroll } from '../collection/kinetic-scroll';
import { UIInteraction, type UIInteractionData } from '../input/interactable';
import { getEntityDepth } from '../util/helpers';
import { UIDialog, createDialogSystem } from './dialog';
import { UISlider, createSliderSystem } from './slider';
import { registerComponent } from '../../component';

/** Screen-px slop before a press becomes a scroll drag (matches Draggable). */
const SCROLL_DRAG_THRESHOLD_PX = 5;

/**
 * Wires the Layer 2 behavior systems — list views and scroll containers — and
 * owns the shared event bus. Interaction *state* (button hover/pressed pages)
 * lives in the controller layer: the `$interaction` UIController driver + gear
 * apply (see ui/controller).
 *
 * Depends on the existing hit-test system to have written UIInteraction
 * during PreUpdate; these systems run in Update and react to that data.
 */
export class UIBehaviorPlugin implements Plugin {
    name = 'uiBehavior';
    dependencies = [PluginName.UIInteraction];

    private events_: UIEventQueue | null = null;
    private listViews_: ListViewRegistry | null = null;
    private scrollContainers_: ScrollContainerRegistry | null = null;

    /** The authoritative event queue for this app instance. */
    get events(): UIEventQueue {
        if (!this.events_) {
            throw new Error('UIBehaviorPlugin.events accessed before build()');
        }
        return this.events_;
    }

    /**
     * Register a ListView so its `update()` is invoked each frame.
     */
    registerListView(list: ListView<unknown>): void {
        if (!this.listViews_) {
            throw new Error('UIBehaviorPlugin.registerListView called before build()');
        }
        this.listViews_.add(list);
    }

    unregisterListView(list: ListView<unknown>): void {
        this.listViews_?.remove(list);
    }

    /**
     * Attach a ScrollContainer to an entity. Wheel and drag/touch input drive
     * it while the entity's UIInteraction.hovered flag is true.
     */
    attachScrollContainer(entity: Entity, container: ScrollContainer): void {
        if (!this.scrollContainers_) {
            throw new Error('UIBehaviorPlugin.attachScrollContainer called before build()');
        }
        this.scrollContainers_.attach(entity, container);
    }

    detachScrollContainer(entity: Entity): void {
        this.scrollContainers_?.detach(entity);
    }

    build(app: App): void {
        // UIInteractionPlugin (declared as our dependency) owns the
        // UIEvents resource and wires onDespawn cleanup. We just grab
        // the queue so our systems emit into the same bus.
        const events = app.getResource(UIEvents) as UIEventQueue;
        this.events_ = events;

        const listViews = new ListViewRegistry();
        this.listViews_ = listViews;

        const scrollContainers = new ScrollContainerRegistry();
        this.scrollContainers_ = scrollContainers;
        app.world.onDespawn((entity) => scrollContainers.detach(entity));

        const world = app.world;

        registerComponent('UIDialog', UIDialog);
        app.addSystemToSchedule(
            Schedule.Update,
            createDialogSystem(world, events),
            { runIf: playModeOnly },
        );

        registerComponent('UISlider', UISlider);
        app.addSystemToSchedule(
            Schedule.Update,
            createSliderSystem(world, events),
            { runIf: playModeOnly },
        );

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem([], () => listViews.tick(), { name: 'ListViewSystem' }),
        );
        // Fling state per scroll entity, shared between the wheel and drag
        // systems so either input source interrupts a coast.
        const dynamics = new Map<Entity, KineticScroll>();
        const dynamicsFor = (entity: Entity, container: ScrollContainer): KineticScroll => {
            let d = dynamics.get(entity);
            if (!d) {
                d = new KineticScroll({ decelerationRate: container.getDecelerationRate() });
                dynamics.set(entity, d);
            }
            return d;
        };
        app.world.onDespawn((entity) => dynamics.delete(entity));

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem([Res(Input)], (input: InputState) => {
                const dx = input.scrollDeltaX;
                const dy = input.scrollDeltaY;
                if (dx === 0 && dy === 0) return;
                // Deepest hovered container wins (same arbitration as drag
                // scrolling) — a wheel over a nested list must not scroll its
                // ancestor too.
                let best: Entity | null = null;
                let bestDepth = -1;
                for (const [entity] of scrollContainers.entries()) {
                    if (!world.has(entity as Entity, UIInteraction)) continue;
                    const ui = world.get(entity as Entity, UIInteraction) as UIInteractionData;
                    if (!ui.hovered) continue;
                    const depth = getEntityDepth(world, entity as Entity);
                    if (depth > bestDepth) {
                        bestDepth = depth;
                        best = entity as Entity;
                    }
                }
                if (best !== null) {
                    const container = scrollContainers.get(best)!;
                    dynamics.get(best)?.stop(); // wheel takes over from a fling
                    const speed = container.getWheelSpeed();
                    container.scrollBy({ x: dx * speed, y: dy * speed });
                }
            }, { name: 'ScrollWheelSystem' }),
        );

        // Drag/touch scrolling — pointer-based (the platform layer funnels the
        // primary touch into the pointer stream), same pending → slop → active
        // capture shape as DragSystem.
        let pendingEntity: Entity | null = null;
        let activeEntity: Entity | null = null;
        let grabStartWorld: Vec2 = { x: 0, y: 0 };
        let grabStartOffset: Vec2 = { x: 0, y: 0 };
        let lastOffset: Vec2 = { x: 0, y: 0 };

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo), Res(Time)],
            (input: InputState, camera: UICameraData, time: TimeData) => {
                if (!camera.valid) return;
                const worldMouse = { x: camera.worldMouseX, y: camera.worldMouseY };

                // Press over a hovered container arms the drag; deepest hovered
                // wins so a nested list scrolls itself, not its ancestor.
                if (input.isMouseButtonPressed(0)) {
                    let best: Entity | null = null;
                    let bestDepth = -1;
                    for (const [entity, container] of scrollContainers.entries()) {
                        if (!container.getDragScroll()) continue;
                        if (!world.has(entity as Entity, UIInteraction)) continue;
                        const ui = world.get(entity as Entity, UIInteraction) as UIInteractionData;
                        if (!ui.hovered) continue;
                        const depth = getEntityDepth(world, entity as Entity);
                        if (depth > bestDepth) {
                            bestDepth = depth;
                            best = entity as Entity;
                        }
                    }
                    if (best !== null) {
                        const container = scrollContainers.get(best)!;
                        dynamicsFor(best, container).stop();
                        pendingEntity = best;
                        grabStartWorld = { x: worldMouse.x, y: worldMouse.y };
                    }
                }

                // Released before crossing the slop: it was a tap/click, not a drag.
                if (pendingEntity !== null && !input.isMouseButtonDown(0)) {
                    pendingEntity = null;
                }

                // Cross the slop threshold (screen px, like Draggable) → grab.
                if (pendingEntity !== null && activeEntity === null) {
                    const container = scrollContainers.get(pendingEntity);
                    if (!container) {
                        pendingEntity = null;
                    } else {
                        const dx = worldMouse.x - grabStartWorld.x;
                        const dy = worldMouse.y - grabStartWorld.y;
                        const worldSpan = camera.worldRight - camera.worldLeft;
                        const screenDist = Math.hypot(dx, dy) * (worldSpan !== 0 ? camera.vpW / worldSpan : 1);
                        if (screenDist >= SCROLL_DRAG_THRESHOLD_PX) {
                            activeEntity = pendingEntity;
                            pendingEntity = null;
                            grabStartOffset = container.getOffset();
                            lastOffset = { x: grabStartOffset.x, y: grabStartOffset.y };
                            dynamicsFor(activeEntity, container).beginDrag();
                        }
                    }
                }

                // Active drag: absolute mapping from the grab point so clamped
                // overshoot re-tracks the finger. World deltas ÷ viewport scale
                // = UI px; world y is up, offset y is down — hence the signs.
                if (activeEntity !== null) {
                    const container = scrollContainers.get(activeEntity);
                    if (!container || !world.valid(activeEntity)) {
                        activeEntity = null;
                        return;
                    }
                    let sx = 1;
                    let sy = 1;
                    if (world.has(activeEntity, Transform)) {
                        const wt = world.get(activeEntity, Transform) as TransformData;
                        if (wt.worldScale.x !== 0) sx = wt.worldScale.x;
                        if (wt.worldScale.y !== 0) sy = wt.worldScale.y;
                    }
                    const totalDx = worldMouse.x - grabStartWorld.x;
                    const totalDy = worldMouse.y - grabStartWorld.y;
                    container.setOffset({
                        x: grabStartOffset.x - totalDx / sx,
                        y: grabStartOffset.y + totalDy / sy,
                    });

                    const now = container.getOffset();
                    const dyn = dynamicsFor(activeEntity, container);
                    dyn.sample({ x: now.x - lastOffset.x, y: now.y - lastOffset.y }, time.delta);
                    lastOffset = now;

                    if (!input.isMouseButtonDown(0)) {
                        dyn.endDrag(); // sampled velocity carries into the coast
                        activeEntity = null;
                    }
                }

                // Coast: tick flung containers; an axis the clamp stops is dead.
                for (const [entity, dyn] of dynamics) {
                    if (!dyn.isCoasting()) continue;
                    const container = scrollContainers.get(entity);
                    if (!container) {
                        dynamics.delete(entity);
                        continue;
                    }
                    const delta = dyn.tick(time.delta);
                    const before = container.getOffset();
                    container.scrollBy(delta);
                    const after = container.getOffset();
                    if (delta.x !== 0 && after.x === before.x) dyn.killAxis('x');
                    if (delta.y !== 0 && after.y === before.y) dyn.killAxis('y');
                }
            },
            { name: 'ScrollDragSystem', runAfter: [SystemLabel.UIInteraction] },
        ), { runIf: playModeOnly });
    }
}

export const uiBehaviorPlugin = new UIBehaviorPlugin();
