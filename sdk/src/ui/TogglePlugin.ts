import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import type { Entity, Color } from '../types';
import { Interactable } from './Interactable';
import type { InteractableData } from './Interactable';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { Toggle } from './Toggle';
import type { ToggleData } from './Toggle';
import { ToggleGroup } from './ToggleGroup';
import type { ToggleGroupData } from './ToggleGroup';
import { UIEvents, UIEventQueue } from './UIEvents';
import { UIRenderer } from './UIRenderer';
import type { UIRendererData } from './UIRenderer';
import { isEditor, isPlayMode } from '../env';
import { applyColorTransition, applyDefaultTint, ensureComponent, withChildEntity } from './uiHelpers';

function setRendererColor(world: import('../world').World, entity: Entity, color: Color): void {
    if (!world.has(entity, UIRenderer)) return;
    const r = world.get(entity, UIRenderer) as UIRendererData;
    if (r.color.r === color.r && r.color.g === color.g && r.color.b === color.b && r.color.a === color.a) return;
    r.color = color;
    world.insert(entity, UIRenderer, r);
}

function setRendererEnabled(world: import('../world').World, entity: Entity, enabled: boolean): void {
    if (!world.has(entity, UIRenderer)) return;
    const r = world.get(entity, UIRenderer) as UIRendererData;
    if (r.enabled === enabled) return;
    r.enabled = enabled;
    world.insert(entity, UIRenderer, r);
}

export class TogglePlugin implements Plugin {
    name = 'toggle';

    build(app: App): void {
        registerComponent('Toggle', Toggle);
        registerComponent('ToggleGroup', ToggleGroup);

        const world = app.world;
        const initializedEntities = new Set<Entity>();

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(UIEvents)],
            (events: UIEventQueue) => {
                const toggleEntities = world.getEntitiesWithComponents([Toggle]);

                if (!isEditor() || isPlayMode()) {
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
                            world.insert(entity, Toggle, toggle);
                        }
                    }
                    const togglesByGroup = new Map<Entity, Entity[]>();
                    for (const entity of toggleEntities) {
                        const toggle = world.get(entity, Toggle) as ToggleData;
                        if (toggle.group !== 0 && world.valid(toggle.group)) {
                            let group = togglesByGroup.get(toggle.group);
                            if (!group) {
                                group = [];
                                togglesByGroup.set(toggle.group, group);
                            }
                            group.push(entity);
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
                            world.insert(entity, Toggle, toggle);

                            if (toggle.isOn && hasGroup) {
                                const siblings = togglesByGroup.get(groupEntity);
                                if (siblings) {
                                    for (const other of siblings) {
                                        if (other === entity) continue;
                                        const otherToggle = world.get(other, Toggle) as ToggleData;
                                        if (otherToggle.isOn) {
                                            otherToggle.isOn = false;
                                            world.insert(other, Toggle, otherToggle);
                                            events.emit(other, 'change');
                                        }
                                    }
                                }
                            }

                            events.emit(entity, 'change');
                        }

                        let color: Color;
                        if (toggle.transition) {
                            color = applyColorTransition(
                                toggle.transition,
                                interactable.enabled,
                                interaction.pressed,
                                interaction.hovered,
                            );
                        } else {
                            const baseColor = toggle.isOn ? toggle.onColor : toggle.offColor;
                            color = applyDefaultTint(baseColor, interactable.enabled, interaction.pressed, interaction.hovered);
                        }
                        setRendererColor(world, entity, color);
                    }
                }

                for (const entity of toggleEntities) {
                    const toggle = world.get(entity, Toggle) as ToggleData;
                    withChildEntity(world, toggle.graphicEntity, (graphic) => {
                        setRendererEnabled(world, graphic, toggle.isOn);
                    });
                }
            },
            { name: 'ToggleSystem' }
        ), { runAfter: ['UIInteractionSystem'] });
    }
}

export const togglePlugin = new TogglePlugin();
