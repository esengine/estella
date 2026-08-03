// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/core/visibility.ts
 * @brief   `shown` / `hidden` — a node arriving on or leaving the screen, as events.
 *
 * A UI node goes away because an ANCESTOR's `display` changed: navigation shows a
 * panel, a tab button shows a page, a dialog closes. Every node under it stops being
 * drawn, and until now nothing said so — a game that wanted "play the entrance when
 * this screen appears" had to walk the parent chain of every animated node itself,
 * every frame, and re-derive what the layout pass had already computed.
 *
 * These are the two events for it, on the same channel as `click`: so the answer is
 * data (an EventBinding row from `shown` to a named action) rather than a system.
 *
 * Visibility is read as the engine's own resolved bit (`hidden_in_tree_`, the same
 * one rendering and hit-testing use), so "visible" cannot drift from what you can
 * see. That bit is only reachable one entity at a time, so the scan is gated twice —
 * it is the whole cost of this file, and on a steady frame it must be nothing:
 *
 *   · nobody listening ⇒ no scan. A producer that has to LOOK for its events should
 *     do nothing into an empty room, and this one has no other reason to run.
 *   · nothing moved ⇒ no scan. `hidden_in_tree_` is a function of authored `display`
 *     and of the tree, so it cannot change unless a UINode was written or the
 *     hierarchy changed — both O(1) to ask about (the same pair PhysicsSystem gates
 *     its reconcile on). A UI that is merely being looked at costs two integer
 *     comparisons per frame.
 */
import type { App, Plugin } from '../../app/app';
import { defineSystem, Schedule } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { playModeOnly } from '../../ecs/env';
import { PluginName, SystemLabel } from '../../ecs/systemLabels';
import type { Entity } from '../../types';
import type { CppRegistry } from '../../wasm';
import { engineApi } from '../../ecs/bridge/engineApi';
import { UIEvents, UIEventQueue, UIEventType } from './events';
import { UINode } from './ui-node';

export class UIVisibilityPlugin implements Plugin {
    name = PluginName.UIVisibility;
    dependencies = [PluginName.UIInteraction]; // for the shared UIEvents resource

    build(app: App): void {
        const world = app.world;
        const engine = engineApi(app);
        const registry = engine ? (world.getCppRegistry() as CppRegistry) : undefined;

        // The layout plugin enables this too; asking again is how this plugin stays
        // correct without depending on it having been built first.
        world.enableChangeTracking(UINode);

        /** Last known on-screen state, so a change can be told from a steady value. */
        const seen = new Map<Entity, boolean>();
        /** Watermarks for the two O(1) gates; -1 ⇒ the next frame scans regardless. */
        let scannedTick = -1;
        let scannedVersion = -1;

        world.onDespawn((entity: Entity) => { seen.delete(entity); });

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(UIEvents)],
            (events: UIEventQueue) => {
                const wanted = events.hasListenersFor(UIEventType.Shown)
                    || events.hasListenersFor(UIEventType.Hidden);
                if (!wanted) {
                    // Drop the baseline too: whoever subscribes next starts from what
                    // is on screen THEN, rather than being told about a change that
                    // happened while nobody was asking.
                    if (seen.size > 0) seen.clear();
                    scannedTick = -1;
                    scannedVersion = -1;
                    return;
                }
                if (!engine?.getUINodeHiddenInTree || !registry) return;

                // `hidden_in_tree_` is written by the layout pass out of authored
                // `display` and the hierarchy — so a frame that wrote no UINode and
                // moved no entity cannot have changed it. The structural version covers
                // spawn / despawn / reparent (a reparent touches Parent and Children,
                // never UINode); the change tick covers an edited `display`.
                const version = world.getWorldVersion();
                const moved = version !== scannedVersion
                    || world.anyChangedSince(UINode, scannedTick);
                if (!moved) return;
                scannedVersion = version;
                // The previous tick, not this one: `anyChangedSince` is exclusive, and a
                // write can still land later in the frame now running — the late layout
                // pass in PostUpdate is exactly that. Costs at most one extra scan while
                // a change settles; UILayoutPlugin takes the same watermark for the same
                // reason.
                scannedTick = world.getWorldTick() - 1;

                for (const entity of world.getEntitiesWithComponents([UINode])) {
                    const shown = !engine.getUINodeHiddenInTree(registry, entity);
                    const before = seen.get(entity);
                    seen.set(entity, shown);
                    // These are CHANGES, so the first look at a node only records it. Not
                    // just to keep a listener that attaches mid-game from being told that
                    // every panel on screen just appeared: a node is created before the
                    // layout pass has taken it into the tree, so its first reading is
                    // "not on screen" — announced, that is a spurious `hidden` on
                    // something that is in the middle of being spawned.
                    if (before === undefined || before === shown) continue;
                    events.emit(entity, shown ? UIEventType.Shown : UIEventType.Hidden);
                }
            },
            { name: 'UIVisibilityEventSystem' },
        ), { runAfter: [SystemLabel.UILayout], runIf: playModeOnly });
    }
}

export const uiVisibilityPlugin = new UIVisibilityPlugin();
