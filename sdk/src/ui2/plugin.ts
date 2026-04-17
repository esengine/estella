import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';

import { UIEventBus, UIEventQueue } from './core/events';
import {
    createInteractableDriverSystem,
    createStateMachineDiffSystem,
    createStateVisualsApplySystem,
} from './behavior/systems';
import { ListView, ListViewRegistry } from './collection/list-view';

/**
 * Wires the Layer 2 behavior systems — interactable-driven state machine
 * diffing and state-visual application — and owns the shared event bus.
 *
 * Depends on the existing hit-test system to have written UIInteraction
 * during PreUpdate; these systems run in Update and react to that data.
 */
export class UIBehaviorPlugin implements Plugin {
    name = 'uiBehavior';

    private events_: UIEventQueue | null = null;
    private listViews_: ListViewRegistry | null = null;

    /** The authoritative event queue for this app instance. */
    get events(): UIEventQueue {
        if (!this.events_) {
            throw new Error('UIBehaviorPlugin.events accessed before build()');
        }
        return this.events_;
    }

    /**
     * Register a ListView so its `update()` is invoked each frame.
     * ListView is typically constructed right after the plugin is
     * installed, so callers hold onto this plugin to register.
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

    build(app: App): void {
        const events = new UIEventQueue();
        this.events_ = events;
        app.insertResource(UIEventBus, events);
        app.world.onDespawn((entity) => events.removeAll(entity));

        const listViews = new ListViewRegistry();
        this.listViews_ = listViews;

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
    }
}

export const uiBehaviorPlugin = new UIBehaviorPlugin();
