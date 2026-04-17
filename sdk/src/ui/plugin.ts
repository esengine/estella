import type { App, Plugin } from '../app';
import { Res } from '../resource';
import { defineSystem, Schedule } from '../system';
import { Input, type InputState } from '../input';
import type { Entity } from '../types';

import { UIEvents, UIEventQueue } from './core/events';
import { PluginName } from '../systemLabels';
import {
    createInteractableDriverSystem,
    createStateMachineDiffSystem,
    createStateVisualsApplySystem,
} from './behavior/systems';
import { ListView, ListViewRegistry } from './collection/list-view';
import { ScrollContainer, ScrollContainerRegistry } from './collection/scroll-container';
import { UIInteraction, type UIInteractionData } from './behavior/interactable';

/**
 * Wires the Layer 2 behavior systems — interactable-driven state machine
 * diffing and state-visual application — and owns the shared event bus.
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
     * Attach a ScrollContainer to an entity. A wheel-driven system
     * applies mouse-wheel input to the container whenever the entity's
     * UIInteraction.hovered flag is true.
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

        app.addSystemToSchedule(
            Schedule.Update,
            createInteractableDriverSystem(app.world),
        );
        app.addSystemToSchedule(
            Schedule.Update,
            createStateMachineDiffSystem(app.world, events),
            { runAfter: ['InteractableDriverSystem'] },
        );
        app.addSystemToSchedule(
            Schedule.Update,
            createStateVisualsApplySystem(app.world),
            { runAfter: ['StateMachineDiffSystem'] },
        );
        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem([], () => listViews.tick(), { name: 'ListViewSystem' }),
        );
        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem([Res(Input)], (input: InputState) => {
                const dx = input.scrollDeltaX;
                const dy = input.scrollDeltaY;
                if (dx === 0 && dy === 0) return;
                for (const [entity, container] of scrollContainers.entries()) {
                    if (!world.has(entity as Entity, UIInteraction)) continue;
                    const ui = world.get(entity as Entity, UIInteraction) as UIInteractionData;
                    if (!ui.hovered) continue;
                    const speed = container.getWheelSpeed();
                    container.scrollBy({ x: dx * speed, y: dy * speed });
                }
            }, { name: 'ScrollWheelSystem' }),
        );
    }
}

export const uiBehaviorPlugin = new UIBehaviorPlugin();
