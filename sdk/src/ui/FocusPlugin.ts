import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Input } from '../input';
import type { InputState } from '../input';
import type { Entity } from '../types';
import { Focusable, FocusManager, FocusManagerState } from './Focusable';
import type { FocusableData } from './Focusable';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { UIEvents, UIEventQueue } from './UIEvents';

export class FocusPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Focusable', Focusable);

        const world = app.world;
        const focusManager = new FocusManagerState();
        app.insertResource(FocusManager, focusManager);

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Input), Res(UIEvents)],
            (input: InputState, events: UIEventQueue) => {
                const focusableEntities = world.getEntitiesWithComponents([Focusable]);

                for (const entity of focusableEntities) {
                    if (!world.has(entity, UIInteraction)) continue;
                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    if (interaction.justPressed) {
                        setFocus(entity);
                    }
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

                    setFocus(sorted[nextIdx]);
                }

                function getSortedFocusables(): Entity[] {
                    const entries: { entity: Entity; tabIndex: number }[] = [];
                    for (const entity of focusableEntities) {
                        const f = world.get(entity, Focusable) as FocusableData;
                        entries.push({ entity, tabIndex: f.tabIndex });
                    }
                    entries.sort((a, b) => a.tabIndex - b.tabIndex);
                    return entries.map(e => e.entity);
                }

                function setFocus(entity: Entity): void {
                    const prev = focusManager.focusedEntity;
                    if (prev === entity) return;

                    if (prev !== null && world.valid(prev) && world.has(prev, Focusable)) {
                        const prevF = world.get(prev, Focusable) as FocusableData;
                        prevF.isFocused = false;
                        events.emit(prev, 'blur', prev);
                    }

                    focusManager.focus(entity);
                    const f = world.get(entity, Focusable) as FocusableData;
                    f.isFocused = true;
                    events.emit(entity, 'focus', entity);
                }
            },
            { name: 'FocusSystem' }
        ));
    }
}

export const focusPlugin = new FocusPlugin();
