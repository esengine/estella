import type { App, Plugin } from '../app';
import { registerComponent, LocalTransform } from '../component';
import type { LocalTransformData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import type { Entity } from '../types';
import { Dropdown } from './Dropdown';
import type { DropdownData } from './Dropdown';
import { Interactable } from './Interactable';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { UIEvents, UIEventQueue } from './UIEvents';
import { Input } from '../input';
import type { InputState } from '../input';

export class DropdownPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Dropdown', Dropdown);

        const world = app.world;

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Input), Res(UIEvents)],
            (input: InputState, events: UIEventQueue) => {
                const entities = world.getEntitiesWithComponents([Dropdown]);
                for (const entity of entities) {
                    if (!world.has(entity, Interactable)) {
                        world.insert(entity, Interactable, { enabled: true, blockRaycast: true });
                    }

                    const dropdown = world.get(entity, Dropdown) as DropdownData;
                    const interaction = world.has(entity, UIInteraction)
                        ? world.get(entity, UIInteraction) as UIInteractionData
                        : null;

                    if (interaction?.justPressed) {
                        dropdown.isOpen = !dropdown.isOpen;
                        setListScale(dropdown.listEntity, dropdown.isOpen);
                        events.emit(entity, 'change', entity);
                    }

                    if (dropdown.isOpen && input.isMouseButtonPressed(0)) {
                        if (!interaction?.hovered) {
                            const listHovered = dropdown.listEntity !== 0
                                && world.valid(dropdown.listEntity as Entity)
                                && world.has(dropdown.listEntity as Entity, UIInteraction)
                                && (world.get(dropdown.listEntity as Entity, UIInteraction) as UIInteractionData).hovered;

                            if (!listHovered) {
                                dropdown.isOpen = false;
                                setListScale(dropdown.listEntity, false);
                            }
                        }
                    }
                }

                function setListScale(listEntityId: number, visible: boolean): void {
                    if (listEntityId === 0) return;
                    const listEntity = listEntityId as Entity;
                    if (!world.valid(listEntity) || !world.has(listEntity, LocalTransform)) return;
                    const lt = world.get(listEntity, LocalTransform) as LocalTransformData;
                    const s = visible ? 1 : 0;
                    lt.scale = { x: s, y: s, z: s };
                    world.insert(listEntity, LocalTransform, lt);
                }
            },
            { name: 'DropdownSystem' }
        ));
    }
}

export const dropdownPlugin = new DropdownPlugin();
