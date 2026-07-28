// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app';
import { registerComponent } from '../../ecs/component';
import { defineSystem, Schedule } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { Input } from '../../input/input';
import type { InputState } from '../../input/input';
import type { Entity } from '../../types';
import { Focusable, FocusManager, FocusManagerState } from './focusable';
import type { FocusableData } from './focusable';
import { Interactable } from './interactable';
import type { InteractableData } from './interactable';
import { UIInteraction } from './interactable';
import type { UIInteractionData } from './interactable';
import { TextInput } from '../text/text-input';
import { UIDialog, isDialogOpen } from '../behavior/dialog';
import { walkParentChain } from '../util/helpers';
import { playModeOnly } from '../../env';
import { UIEvents, UIEventQueue, UIEventType } from '../core/events';
import { PluginName } from '../../ecs/systemLabels';
import type { CppRegistry } from '../../wasm';
import { engineApi } from '../../ecs/bridge/engineApi';

export class FocusPlugin implements Plugin {
    name = PluginName.Focus;
    dependencies = [PluginName.UIInteraction];

    build(app: App): void {
        registerComponent('Focusable', Focusable);

        const world = app.world;
        const engine = engineApi(app);
        const registry = engine ? (world.getCppRegistry() as CppRegistry) : undefined;
        const focusManager = new FocusManagerState();
        app.insertResource(FocusManager, focusManager);

        // display:none removes an entity from rendering + hit-testing; the Tab
        // ring must skip it too or focus lands on invisible controls.
        const hiddenInTree = (e: Entity): boolean =>
            !!(engine?.getUINodeHiddenInTree && registry
                && engine.getUINodeHiddenInTree(registry, e));

        // An open modal traps the Tab ring: only focusables inside an open
        // UIDialog subtree participate while one is up (the scrim already
        // blocks pointer focus outside).
        const openDialogRoots = (): Entity[] =>
            world.getEntitiesWithComponents([UIDialog]).filter((e) => isDialogOpen(world, e));
        const insideAny = (entity: Entity, roots: Entity[]): boolean => {
            if (roots.length === 0) return true;
            const set = new Set(roots.map((r) => r as number));
            if (set.has(entity as number)) return true;
            let inside = false;
            walkParentChain(world, entity, (ancestor) => {
                if (set.has(ancestor as number)) {
                    inside = true;
                    return true;
                }
                return false;
            });
            return inside;
        };

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Input), Res(UIEvents)],
            (input: InputState, events: UIEventQueue) => {
                if (focusManager.focusedEntity !== null && !world.valid(focusManager.focusedEntity)) {
                    focusManager.focusedEntity = null;
                } else if (focusManager.focusedEntity !== null && hiddenInTree(focusManager.focusedEntity)) {
                    // A focused control hidden out from under us (e.g. a dialog closed
                    // by its own Confirm button) must lose focus, or a later Enter/Space
                    // would re-fire Click on the now-invisible control.
                    clearFocus();
                }

                const focusableEntities = world.getEntitiesWithComponents([Focusable]);

                let pressedFocusable = false;
                for (const entity of focusableEntities) {
                    if (!world.has(entity, UIInteraction)) continue;
                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    if (interaction.justPressed) {
                        pressedFocusable = true;
                        // Focus, but NOT visibly: a pointer press moves focus so
                        // Enter/Space act on what you clicked, while the control
                        // keeps looking the way the pointer left it.
                        setFocus(entity, false);
                    }
                }

                // A press anywhere that is not a focusable clears focus, and so
                // does Escape — standard focus-dismissal affordances.
                if (focusManager.focusedEntity !== null) {
                    const pressedElsewhere = input.isMouseButtonPressed(0) && !pressedFocusable;
                    if (pressedElsewhere || input.isKeyPressed('Escape')) clearFocus();
                }

                // Keyboard activation: Enter/Space on the focused control acts as
                // a click. Text fields consume those keys for editing instead.
                const focused = focusManager.focusedEntity;
                if (focused !== null && world.valid(focused) && !world.has(focused, TextInput)
                    && (input.isKeyPressed('Enter') || input.isKeyPressed('Space'))) {
                    const enabled = !world.has(focused, Interactable)
                        || (world.get(focused, Interactable) as InteractableData).enabled;
                    if (enabled) events.emit(focused, UIEventType.Click);
                }

                if (input.isKeyPressed('Tab')) {
                    const sorted = getSortedFocusables();
                    if (sorted.length === 0) return;

                    const currentIdx = focusManager.focusedEntity !== null
                        ? sorted.findIndex(e => e === focusManager.focusedEntity)
                        : -1;

                    const reverse = input.isKeyDown('Shift');
                    let nextIdx: number;
                    if (currentIdx === -1) {
                        nextIdx = reverse ? sorted.length - 1 : 0;
                    } else {
                        nextIdx = reverse
                            ? (currentIdx - 1 + sorted.length) % sorted.length
                            : (currentIdx + 1) % sorted.length;
                    }

                    // Tab is the case the highlight exists for — nothing else says
                    // where you are.
                    setFocus(sorted[nextIdx], true);
                }

                function getSortedFocusables(): Entity[] {
                    const trapRoots = openDialogRoots();
                    const entries: { entity: Entity; tabIndex: number }[] = [];
                    for (const entity of focusableEntities) {
                        if (!world.valid(entity)) continue;
                        if (world.has(entity, Interactable)) {
                            const interactable = world.get(entity, Interactable) as InteractableData;
                            if (!interactable.enabled) continue;
                        }
                        if (hiddenInTree(entity)) continue;
                        if (!insideAny(entity, trapRoots)) continue;
                        const f = world.get(entity, Focusable) as FocusableData;
                        entries.push({ entity, tabIndex: f.tabIndex });
                    }
                    entries.sort((a, b) => a.tabIndex - b.tabIndex);
                    return entries.map(e => e.entity);
                }

                function setFocus(entity: Entity, visible: boolean): void {
                    const prev = focusManager.focusedEntity;
                    // Re-focusing what is already focused still updates HOW: tabbing
                    // to a control you had clicked must start drawing the highlight.
                    if (prev === entity) {
                        focusManager.focusVisible = visible;
                        return;
                    }

                    blurEntity(prev);
                    focusManager.focus(entity, visible);
                    const f = world.get(entity, Focusable) as FocusableData;
                    f.isFocused = true;
                    world.insert(entity, Focusable, f);
                    events.emit(entity, UIEventType.Focus);
                }

                function clearFocus(): void {
                    blurEntity(focusManager.focusedEntity);
                    focusManager.blur();
                }

                function blurEntity(entity: Entity | null): void {
                    if (entity === null || !world.valid(entity) || !world.has(entity, Focusable)) return;
                    const f = world.get(entity, Focusable) as FocusableData;
                    f.isFocused = false;
                    world.insert(entity, Focusable, f);
                    events.emit(entity, UIEventType.Blur);
                }
            },
            { name: 'FocusSystem' }
        ), { runIf: playModeOnly });
    }
}

export const focusPlugin = new FocusPlugin();
