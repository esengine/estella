// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app/app';
import { Res, Time, type TimeData } from '../../ecs/resource';
import { defineSystem, Schedule } from '../../ecs/system';
import { Input, type InputState } from '../../input/input';
import { primaryPointerCancellationVersion } from '../../input/pointerCancellation';
import { Transform, type TransformData } from '../../ecs/component';
import { playModeOnly } from '../../ecs/env';
import type { Entity, Vec2 } from '../../types';

import { UIEvents, UIEventQueue } from '../core/events';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { ScreenLayout, type ScreenLayoutData } from '../core/screen-layout';
import { ScreenOverlay, type ScreenOverlayData } from '../core/screen-overlay';
import { uiPointerFor } from '../util/ui-pick';
import { PluginName, SystemLabel } from '../../ecs/systemLabels';
import { ListView, ListViewRegistry } from '../collection/list-view';
import { UICollections } from '../collection/collection-host';
import { UIConsumesDrag } from '../input/drag-consumption';
import { ScrollContainer, ScrollContainerRegistry } from '../collection/scroll-container';
import { createScrollAdoptSystem } from './scroll';
import { engineApi } from '../../ecs/bridge/engineApi';
import type { CppRegistry } from '../../wasm';
import { ScrollMotion } from '../collection/scroll-motion';
import { Interactable, UIInteraction, type UIInteractionData } from '../input/interactable';
import { UINode } from '../core/ui-node';
import { getEntityDepth, walkParentChain } from '../util/helpers';
import { UIDialog, createDialogSystem } from './dialog';
import { UISlider, createSliderSystem } from './slider';
import { UIToggle, UIToggleGroup, createToggleSystem } from './toggle';
import { UIDropdown, createDropdownSystem } from './dropdown';
import { createScrollbarSystem } from './scrollbar';
import { registerComponent } from '../../ecs/component';
import { VirtualJoystick, VirtualButton, createVirtualControlSystem } from './virtual-controls';
import { UITabView, createTabViewSystem } from './tab-view';
import { UITooltip, createTooltipSystem } from './tooltip';
import type { PrefabServer } from '../../prefab/prefabServer';

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
    readonly profileDomain = 'ui';
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

    private readonly controlCleanup_ = new WeakMap<App, () => void>();

    cleanup(app?: App): void {
        if (app) { this.controlCleanup_.get(app)?.(); this.controlCleanup_.delete(app); }
    }

    build(app: App): void {
        this.cleanup(app);
        // UIInteractionPlugin (declared as our dependency) owns the
        // UIEvents resource and wires onDespawn cleanup. We just grab
        // the queue so our systems emit into the same bus.
        const events = app.getResource(UIEvents) as UIEventQueue;
        this.events_ = events;

        const listViews = new ListViewRegistry();
        this.listViews_ = listViews;

        const scrollContainers = new ScrollContainerRegistry();
        this.scrollContainers_ = scrollContainers;
        app.insertResource(UICollections, {
            registerListView: list => listViews.add(list), unregisterListView: list => listViews.remove(list),
            attachScrollContainer: (entity, container) => scrollContainers.attach(entity, container),
            detachScrollContainer: entity => scrollContainers.detach(entity),
        });
        app.world.onDespawn((entity) => scrollContainers.detach(entity));

        const world = app.world;
        const engine = engineApi(app);
        const registry = world.getCppRegistry() as CppRegistry;
        const scrollAvailable = (entity: Entity): boolean => world.isEntityActive(entity)
            && !world.isDestructionPending(entity)
            && (!world.has(entity, Interactable) || world.get(entity, Interactable).enabled)
            && (!world.has(entity, UINode) || !engine?.getUINodeHiddenInTree?.(registry, entity));

        registerComponent('UIDialog', UIDialog);
        app.addSystemToSchedule(
            Schedule.Update,
            createDialogSystem(world, events),
            { runIf: playModeOnly },
        );

        registerComponent('VirtualJoystick', VirtualJoystick);
        registerComponent('VirtualButton', VirtualButton);
        const virtualControls = createVirtualControlSystem(world, events);
        this.controlCleanup_.set(app, virtualControls.dispose);
        app.addSystemToSchedule(Schedule.PreUpdate, virtualControls.system,
            { runAfter: [SystemLabel.UIInteraction], runIf: playModeOnly });

        registerComponent('UISlider', UISlider);
        app.addSystemToSchedule(
            Schedule.Update,
            createSliderSystem(world, events),
            { runIf: playModeOnly },
        );

        registerComponent('UIToggle', UIToggle);
        registerComponent('UIToggleGroup', UIToggleGroup);
        app.addSystemToSchedule(
            Schedule.Update,
            createToggleSystem(world, events),
            { runIf: playModeOnly },
        );

        registerComponent('UITabView', UITabView);
        registerComponent('UITooltip', UITooltip);
        app.addSystemToSchedule(Schedule.Update, createTabViewSystem(world, events), { runIf: playModeOnly });
        const tooltips = createTooltipSystem(world, { instantiate: (ref, parent) => {
            const prefabs = app.getResourceByName('Prefabs') as PrefabServer | undefined;
            if (!prefabs) return Promise.reject(new Error('Tooltip style prefabs require PrefabsPlugin'));
            return prefabs.instantiate(ref, { parent, scene: false });
        } }, playModeOnly);
        const offTooltipExecution = app.onExecutionChange(held => { if (held) tooltips.reset(); });
        this.controlCleanup_.set(app, () => { virtualControls.dispose(); offTooltipExecution(); tooltips.dispose(); });
        app.addSystemToSchedule(Schedule.Update, tooltips.system);

        registerComponent('UIDropdown', UIDropdown);
        app.addSystemToSchedule(
            Schedule.Update,
            createDropdownSystem(world, events),
            { runIf: playModeOnly },
        );

        // A scroll area authored in a scene becomes a live one here, so the
        // editor's ScrollView and a hand-built UIScroll node scroll for the same
        // reason the widget does — one input path, one container registry.
        app.addSystemToSchedule(
            Schedule.Update,
            createScrollAdoptSystem(world, engineApi(app), world.getCppRegistry() as CppRegistry, this),
            { runIf: playModeOnly },
        );

        app.addSystemToSchedule(
            Schedule.Update,
            createScrollbarSystem(world, scrollContainers),
            { runIf: playModeOnly },
        );

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem([], () => listViews.tick(), { name: 'ListViewSystem' }),
        );
        // Fling state per scroll entity, shared between the wheel and drag
        // systems so either input source interrupts a coast.
        const dynamics = new Map<Entity, { container: ScrollContainer; motion: ScrollMotion }>();
        const dynamicsFor = (entity: Entity, container: ScrollContainer): ScrollMotion => {
            let d = dynamics.get(entity);
            if (!d || d.container !== container) {
                d = { container, motion: new ScrollMotion(container) };
                dynamics.set(entity, d);
            }
            return d.motion;
        };
        app.world.onDespawn((entity) => dynamics.delete(entity));

        // The hit-test flags only the single topmost interactable as hovered, so
        // a wheel/drag over an interactive list row (a button, etc.) leaves the
        // enclosing viewport un-hovered. Resolve the scroll target from the
        // hovered hit by walking up (self-inclusive) to the nearest attached
        // container; the first container found is the innermost, preserving
        // nested-list arbitration. `dragOnly` keeps the drag path to drag-scroll
        // containers.
        const hoveredScrollTarget = (dragOnly: boolean): Entity | null => {
            let hovered: Entity | null = null;
            let hoveredDepth = -1;
            for (const entity of world.getEntitiesWithComponents([UIInteraction])) {
                const ui = world.get(entity, UIInteraction) as UIInteractionData;
                if (!ui.hovered) continue;
                const depth = getEntityDepth(world, entity);
                if (depth > hoveredDepth) {
                    hoveredDepth = depth;
                    hovered = entity;
                }
            }
            if (hovered === null) return null;
            if (dragOnly && world.has(hovered, UIConsumesDrag)) return null;
            const eligible = (e: Entity): boolean => {
                const c = scrollContainers.get(e);
                return !!c && scrollAvailable(e) && (!dragOnly || c.getDragScroll());
            };
            if (eligible(hovered)) return hovered;
            let found: Entity | null = null;
            walkParentChain(world, hovered, (ancestor) => {
                if (dragOnly && world.has(ancestor, UIConsumesDrag)) return true;
                if (eligible(ancestor)) {
                    found = ancestor;
                    return true;
                }
                return false;
            });
            return found;
        };

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem([Res(Input)], (input: InputState) => {
                const dx = input.scrollDeltaX;
                const dy = input.scrollDeltaY;
                if (dx === 0 && dy === 0) return;
                const best = hoveredScrollTarget(false);
                if (best !== null) {
                    const container = scrollContainers.get(best)!;
                    dynamics.get(best)?.motion.stop(); // wheel takes over from a fling
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
        let capturedContainer: ScrollContainer | null = null;
        let lastCancellationVersion = primaryPointerCancellationVersion(app.getResource(Input));
        let grabStartWorld: Vec2 = { x: 0, y: 0 };

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo), Res(Time), Res(ScreenLayout), Res(ScreenOverlay)],
            (input: InputState, camera: UICameraData, time: TimeData, layout: ScreenLayoutData,
             overlay: ScreenOverlayData) => {
                const cancellationVersion = primaryPointerCancellationVersion(input);
                const cancelled = cancellationVersion !== lastCancellationVersion;
                lastCancellationVersion = cancellationVersion;
                if (cancelled) dynamics.clear();
                if (!camera.valid && !overlay.active) {
                    activeEntity = pendingEntity = null;
                    capturedContainer = null;
                    dynamics.clear();
                    return;
                }
                const captured = activeEntity ?? pendingEntity;
                if (captured !== null && (cancelled || !scrollAvailable(captured)
                    || scrollContainers.get(captured) !== capturedContainer)) {
                    dynamics.get(captured)?.motion.stop();
                    activeEntity = pendingEntity = null;
                    capturedContainer = null;
                }
                // In the domain the grabbed container is laid out in — a scroll
                // subtracts a pointer from a transform, like a drag does.
                const pointerFor = (entity: Entity): { x: number; y: number } =>
                    uiPointerFor(world, entity, camera, overlay);

                // Press over a hovered container (or an interactive child of one)
                // arms the drag; the nearest container wins so a nested list
                // scrolls itself, not its ancestor.
                if (input.isMouseButtonPressed(0) && input.isMouseButtonDown(0)) {
                    const best = hoveredScrollTarget(true);
                    if (best !== null) {
                        const container = scrollContainers.get(best)!;
                        capturedContainer = container;
                        dynamicsFor(best, container).stop();
                        pendingEntity = best;
                        grabStartWorld = pointerFor(best);
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
                        const pointer = pointerFor(pendingEntity);
                        const dx = pointer.x - grabStartWorld.x;
                        const dy = pointer.y - grabStartWorld.y;
                        const screenDist = Math.hypot(dx, dy) * layout.scale;
                        if (screenDist >= SCROLL_DRAG_THRESHOLD_PX) {
                            activeEntity = pendingEntity;
                            pendingEntity = null;
                            dynamicsFor(activeEntity, container).grab();
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
                    const pointer = pointerFor(activeEntity);
                    const totalDx = pointer.x - grabStartWorld.x;
                    const totalDy = pointer.y - grabStartWorld.y;
                    const dyn = dynamicsFor(activeEntity, container);
                    dyn.dragBy({ x: -totalDx / sx, y: totalDy / sy }, time.delta);

                    if (!input.isMouseButtonDown(0)) {
                        dyn.release(); // sampled velocity carries into the coast; an over-pulled end springs back
                        activeEntity = null;
                    }
                }

                // Coast and spring: tick what was let go of. An axis the clamp stops hands its speed to the overscroll.
                for (const [entity, state] of dynamics) {
                    const container = scrollContainers.get(entity);
                    if (container !== state.container || !scrollAvailable(entity)) {
                        dynamics.delete(entity);
                        continue;
                    }
                    state.motion.tick(time.delta);
                }
            },
            { name: 'ScrollDragSystem', runAfter: [SystemLabel.UIInteraction] },
        ), { runIf: playModeOnly });
    }
}

export const uiBehaviorPlugin = new UIBehaviorPlugin();
