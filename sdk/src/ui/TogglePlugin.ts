import type { App, Plugin } from '../app';
import { registerComponent, Sprite } from '../component';
import type { SpriteData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import type { Entity } from '../types';
import { Interactable } from './Interactable';
import type { InteractableData } from './Interactable';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { Toggle } from './Toggle';
import type { ToggleData } from './Toggle';
import { ToggleGroup } from './ToggleGroup';
import type { ToggleGroupData } from './ToggleGroup';
import { UIEvents, UIEventQueue } from './UIEvents';
import { applyColorTransition, ensureComponent } from './uiHelpers';

export class TogglePlugin implements Plugin {
    build(app: App): void {
        registerComponent('Toggle', Toggle);
        registerComponent('ToggleGroup', ToggleGroup);

        const world = app.world;
        const initializedEntities = new Set<Entity>();

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(UIEvents)],
            (events: UIEventQueue) => {
                const toggleEntities = world.getEntitiesWithComponents([Toggle]);

                const groupFirstOn = new Map<Entity, Entity>();
                for (const entity of toggleEntities) {
                    if (initializedEntities.has(entity)) continue;
                    initializedEntities.add(entity);
                    const toggle = world.get(entity, Toggle) as ToggleData;
                    if (!toggle.isOn || toggle.group === 0 || !world.valid(toggle.group)) continue;
                    if (!groupFirstOn.has(toggle.group)) {
                        groupFirstOn.set(toggle.group, entity);
                    } else {
                        toggle.isOn = false;
                    }
                }
                for (const entity of toggleEntities) {
                    ensureComponent(world, entity, Interactable, { enabled: true });
                    if (!world.has(entity, UIInteraction)) continue;

                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    const toggle = world.get(entity, Toggle) as ToggleData;
                    const interactable = world.get(entity, Interactable) as InteractableData;

                    if (interaction.justPressed && interactable.enabled) {
                        const groupEntity = toggle.group;
                        const hasGroup = groupEntity !== 0 && world.valid(groupEntity)
                            && world.has(groupEntity, ToggleGroup);

                        if (toggle.isOn && hasGroup) {
                            const group = world.get(groupEntity, ToggleGroup) as ToggleGroupData;
                            if (!group.allowSwitchOff) continue;
                        }

                        toggle.isOn = !toggle.isOn;

                        if (toggle.isOn && hasGroup) {
                            for (const other of toggleEntities) {
                                if (other === entity) continue;
                                const otherToggle = world.get(other, Toggle) as ToggleData;
                                if (otherToggle.group === groupEntity && otherToggle.isOn) {
                                    otherToggle.isOn = false;
                                    events.emit(other, 'change');
                                }
                            }
                        }

                        events.emit(entity, 'change');
                    }

                    if (toggle.graphicEntity && world.valid(toggle.graphicEntity)) {
                        if (world.has(toggle.graphicEntity, Sprite)) {
                            const sprite = world.get(toggle.graphicEntity, Sprite) as SpriteData;
                            sprite.enabled = toggle.isOn;
                            world.insert(toggle.graphicEntity, Sprite, sprite);
                        }
                    }

                    if (toggle.transition && world.has(entity, Sprite)) {
                        const sprite = world.get(entity, Sprite) as SpriteData;
                        sprite.color = applyColorTransition(
                            toggle.transition,
                            interactable.enabled,
                            interaction.pressed,
                            interaction.hovered,
                        );
                        world.insert(entity, Sprite, sprite);
                    }
                }
            },
            { name: 'ToggleSystem' }
        ));
    }
}

export const togglePlugin = new TogglePlugin();
