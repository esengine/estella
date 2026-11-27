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
import { UIInteraction } from './interactable';
import type { UIInteractionData } from './interactable';
import { TextInput } from '../text/text-input';
import { setKeyDefaultPolicy, tabWasShifted } from '../../input/keyDefaultPolicy';
import { inspectFocusTraversal, isFocusEligible } from './focus-inspection';
import { playModeOnly } from '../../ecs/env';
import { UIEvents, UIEventQueue, UIEventType } from '../core/events';
import { PluginName } from '../../ecs/systemLabels';
import { clearUIFocus, moveUIFocus } from './focus-transition';
import { UITabView, tabViewBindings } from '../behavior/tab-view';
import { UITreeView } from '../behavior/tree-view';
import { UIColorPicker } from '../behavior/color-picker';
import { UISlider } from '../behavior/slider';
import { UIDropdown } from '../core/dropdown-popup';
import { UIDialog } from '../core/ui-dialog';
import { UIControlPointers, type UIControlPointersData } from './control-pointers';
import { escapeLayer } from './overlay-input';

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
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(code)) {
                const focused = focusManager.focusedEntity;
                if (focused !== null && isFocusEligible(world, focused)
                    && (world.has(focused, UITreeView) || world.has(focused, UISlider)
                        || ((code === 'ArrowUp' || code === 'ArrowDown') && world.has(focused, UIDropdown))
                        || (code.startsWith('Arrow') && world.getEntitiesWithComponents([UIColorPicker]).some(root => world.get(root, UIColorPicker).sv === focused)))) return true;
                return world.getEntitiesWithComponents([UITabView]).some(root => {
                    const d = world.get(root, UITabView);
                    return (code === 'Home' || code === 'End' || (d.vertical
                        ? code === 'ArrowUp' || code === 'ArrowDown' : code === 'ArrowLeft' || code === 'ArrowRight'))
                        && tabViewBindings(world, root, d).some(i => d.tabs[i] === focusManager.focusedEntity
                            && isFocusEligible(world, d.tabs[i]));
                });
            }
            if (code !== 'Tab' && code !== 'Enter' && code !== 'Space') return false;
            if (code === 'Tab') return inspectFocusTraversal(world).entries.some(entry => entry.skipped === null);
            const focused = focusManager.focusedEntity;
            return focused !== null && world.valid(focused) && !world.has(focused, TextInput)
                && isFocusEligible(world, focused);
        }));

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Input), Res(UIEvents), Res(UIControlPointers)],
            (input: InputState, events: UIEventQueue, pointers: UIControlPointersData) => {
                // Live eligibility also governs stale focus and pointer focus, so
                // opening a dialog cannot leave activation on a background control.
                // Asked of the one entity in question: the whole Tab ring is sorted only when Tab is pressed.
                const lostFocus = focusManager.focusedEntity !== null
                    && !isFocusEligible(world, focusManager.focusedEntity);
                if (lostFocus) clearFocus();

                const focusableEntities = world.getEntitiesWithComponents([Focusable]);

                let pressedFocusable = false;
                for (const entity of focusableEntities) {
                    if (!world.has(entity, UIInteraction)) continue;
                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    if (interaction.justPressed && isFocusEligible(world, entity)) {
                        pressedFocusable = true;
                        // Focus, but NOT visibly: a pointer press moves focus so
                        // Enter/Space act on what you clicked, while the control
                        // keeps looking the way the pointer left it.
                        setFocus(entity, false);
                    }
                }

                // A row or a scrim dismissing the list belongs to the button for
                // this press, even when a quick tap has already destroyed the row.
                if (!pressedFocusable) for (const pointer of pointers?.pointers.values() ?? []) {
                    const popup = pointer.popupAtPress;
                    if (!pointer.pressed || !popup) continue;
                    const hit = pointer.pressedEntity;
                    if ((popup.inside || (hit !== null && world.valid(hit) && world.has(hit, UIDialog)))
                        && isFocusEligible(world, popup.owner)) {
                        setFocus(popup.owner, false);
                        pressedFocusable = true;
                        break;
                    }
                }

                if (focusManager.focusedEntity !== null) {
                    const pressedElsewhere = input.isMouseButtonPressed(0) && !pressedFocusable;
                    const escapeBlurs = input.isKeyPressed('Escape') && !escapeLayer(world, focusManager.focusedEntity);
                    if (pressedElsewhere || escapeBlurs) clearFocus();
                }

                // Keyboard activation: Enter/Space on the focused control acts as
                // a click. Text fields consume those keys for editing instead.
                const focused = focusManager.focusedEntity;
                // A blur handler can move focus while retiring an invalid target.
                // An activation in this frame must not transfer to that replacement.
                if (!lostFocus && focused !== null && world.valid(focused) && !world.has(focused, TextInput)
                    && (input.isKeyPressed('Enter') || input.isKeyPressed('Space'))) {
                    // Focus/blur handlers can change dialog or enabled state synchronously.
                    if (isFocusEligible(world, focused)) {
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
                    moveUIFocus(world, events, focusManager, entity, visible);
                }

                function clearFocus(): void {
                    clearUIFocus(world, events, focusManager);
                }
            },
            { name: 'FocusSystem' }
        ), { runIf: playModeOnly });
    }
}

export const focusPlugin = new FocusPlugin();
