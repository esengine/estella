// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app/app';
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
import { setKeyDefaultPolicy, tabWasShifted } from '../../input/keyDefaultPolicy';
import { inspectFocusTraversal } from './focus-inspection';
import { playModeOnly } from '../../ecs/env';
import { UIEvents, UIEventQueue, UIEventType } from '../core/events';
import { PluginName } from '../../ecs/systemLabels';
import type { CppRegistry } from '../../wasm';
import { engineApi } from '../../ecs/bridge/engineApi';

export class FocusPlugin implements Plugin {
    name = PluginName.Focus;
    dependencies = [PluginName.UIInteraction];

    private readonly keyDefaults_ = new WeakMap<App, () => void>();

    cleanup(app?: App): void {
        if (!app) return;
        this.keyDefaults_.get(app)?.();
        this.keyDefaults_.delete(app);
    }

    build(app: App): void {
        registerComponent('Focusable', Focusable);

        const world = app.world;
        const engine = engineApi(app);
        const registry = engine ? (world.getCppRegistry() as CppRegistry) : undefined;
        const focusManager = new FocusManagerState();
        app.insertResource(FocusManager, focusManager);
        this.keyDefaults_.get(app)?.();
        this.keyDefaults_.set(app, setKeyDefaultPolicy(app.getResource(Input), code => {
            if (!playModeOnly() || app.isPaused()) return false;
            if (code !== 'Tab' && code !== 'Enter' && code !== 'Space') return false;
            const entries = inspectFocusTraversal(world).entries;
            if (code === 'Tab') return entries.some(entry => entry.skipped === null);
            const focused = focusManager.focusedEntity;
            return focused !== null && world.valid(focused) && !world.has(focused, TextInput)
                && entries.some(entry => entry.entity === focused && entry.skipped === null);
        }));


        // display:none removes an entity from rendering + hit-testing; the Tab
        // ring must skip it too or focus lands on invisible controls.
        const hiddenInTree = (e: Entity): boolean =>
            !!(engine?.getUINodeHiddenInTree && registry
                && engine.getUINodeHiddenInTree(registry, e));

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

                    const reverse = tabWasShifted(input);
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
                    return inspectFocusTraversal(world).entries
                        .filter(entry => entry.skipped === null).map(entry => entry.entity);
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
