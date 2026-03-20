import type { App, Plugin } from '../app';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import type { Entity } from '../types';
import { playModeOnly } from '../env';
import { Interactable } from './Interactable';
import { UIInteraction, type UIInteractionData } from './UIInteraction';
import { Selectable, type SelectableData } from './Selectable';
import { UIEvents, UIEventQueue } from './UIEvents';
import { PluginName } from '../systemLabels';

export class SelectablePlugin implements Plugin {
    name = PluginName.Selectable;
    dependencies = [PluginName.UIInteraction];

    build(app: App): void {
        const world = app.world;

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(UIEvents)],
            (uiEvents: UIEventQueue) => {
                const entities = world.getEntitiesWithComponents([Selectable, Interactable]);

                for (const entity of entities) {
                    if (!world.valid(entity)) continue;
                    if (!world.has(entity, UIInteraction)) continue;

                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    if (!interaction.justPressed) continue;

                    const selectable = world.get(entity, Selectable) as SelectableData;
                    const newSelected = !selectable.selected;

                    if (newSelected && selectable.group !== 0) {
                        for (const other of entities) {
                            if (other === entity || !world.valid(other)) continue;
                            const otherSel = world.get(other, Selectable) as SelectableData;
                            if (otherSel.group === selectable.group && otherSel.selected) {
                                otherSel.selected = false;
                                world.insert(other, Selectable, otherSel);
                                uiEvents.emit(other, 'deselect');
                                break;
                            }
                        }
                    }

                    selectable.selected = newSelected;
                    world.insert(entity, Selectable, selectable);
                    uiEvents.emit(entity, newSelected ? 'select' : 'deselect');
                }
            },
            { name: 'SelectableSystem' },
        ), { runIf: playModeOnly });
    }
}

export const selectablePlugin = new SelectablePlugin();
