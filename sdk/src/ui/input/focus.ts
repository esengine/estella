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
import { UIInteraction } from './interactable';
import type { UIInteractionData } from './interactable';
import { TextInput } from '../text/text-input';
import { setKeyDefaultPolicy, tabWasShifted } from '../../input/keyDefaultPolicy';
import { inspectFocusTraversal } from './focus-inspection';
import { playModeOnly } from '../../ecs/env';
import { UIEvents, UIEventQueue, UIEventType } from '../core/events';
import { PluginName } from '../../ecs/systemLabels';

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

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Input), Res(UIEvents)],
            (input: InputState, events: UIEventQueue) => {
                // Live eligibility also governs stale focus and pointer focus, so
                // opening a dialog cannot leave activation on a background control.
                const eligible = inspectFocusTraversal(world).entries
                    .filter(entry => entry.skipped === null).map(entry => entry.entity);
                const eligibleSet = new Set(eligible);
                if (focusManager.focusedEntity !== null
                    && !eligibleSet.has(focusManager.focusedEntity)) clearFocus();

                const focusableEntities = world.getEntitiesWithComponents([Focusable]);

                let pressedFocusable = false;
                for (const entity of focusableEntities) {
                    if (!world.has(entity, UIInteraction)) continue;
                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    if (interaction.justPressed && eligibleSet.has(entity)) {
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
                    // Focus/blur handlers can change dialog or enabled state synchronously.
                    if (inspectFocusTraversal(world).entries.some(entry => entry.entity === focused && entry.skipped === null)) {
                        events.emit(focused, UIEventType.Click);
                    } else {
                        clearFocus();
                    }
                }

                if (input.isKeyPressed('Tab')) {
                    const sorted = inspectFocusTraversal(world).entries
                        .filter(entry => entry.skipped === null).map(entry => entry.entity);
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
