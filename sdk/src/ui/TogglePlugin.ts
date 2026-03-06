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
import { UIRenderer } from './UIRenderer';
import type { UIRendererData } from './UIRenderer';
import { isEditor, isPlayMode } from '../env';
import { applyColorTransition, applyDefaultTint, ensureComponent } from './uiHelpers';

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

                        if (toggle.transition) {
                            const color = applyColorTransition(
                                toggle.transition,
                                interactable.enabled,
                                interaction.pressed,
                                interaction.hovered,
                            );
                            if (world.has(entity, UIRenderer)) {
                                const r = world.get(entity, UIRenderer) as UIRendererData;
                                r.color = color;
                                world.insert(entity, UIRenderer, r);
                            } else if (world.has(entity, Sprite)) {
                                const sprite = world.get(entity, Sprite) as SpriteData;
                                sprite.color = color;
                                world.insert(entity, Sprite, sprite);
                            }
                        } else {
                            const baseColor = toggle.isOn ? toggle.onColor : toggle.offColor;
                            const tinted = applyDefaultTint(baseColor, interactable.enabled, interaction.pressed, interaction.hovered);
                            if (world.has(entity, UIRenderer)) {
                                const r = world.get(entity, UIRenderer) as UIRendererData;
                                if (r.color.r !== tinted.r || r.color.g !== tinted.g
                                    || r.color.b !== tinted.b || r.color.a !== tinted.a) {
                                    r.color = tinted;
                                    world.insert(entity, UIRenderer, r);
                                }
                            } else if (world.has(entity, Sprite)) {
                                const sprite = world.get(entity, Sprite) as SpriteData;
                                if (sprite.color.r !== tinted.r || sprite.color.g !== tinted.g
                                    || sprite.color.b !== tinted.b || sprite.color.a !== tinted.a) {
                                    sprite.color = tinted;
                                    world.insert(entity, Sprite, sprite);
                                }
                            }
                        }
                    }
                }

                for (const entity of toggleEntities) {
                    const toggle = world.get(entity, Toggle) as ToggleData;
                    if (toggle.graphicEntity && world.valid(toggle.graphicEntity)) {
                        if (world.has(toggle.graphicEntity, UIRenderer)) {
                            const r = world.get(toggle.graphicEntity, UIRenderer) as UIRendererData;
                            r.enabled = toggle.isOn;
                            world.insert(toggle.graphicEntity, UIRenderer, r);
                        } else if (world.has(toggle.graphicEntity, Sprite)) {
                            const sprite = world.get(toggle.graphicEntity, Sprite) as SpriteData;
                            sprite.enabled = toggle.isOn;
                            world.insert(toggle.graphicEntity, Sprite, sprite);
                        }
                    }
                }
            },
            { name: 'ToggleSystem' }
        ), { runAfter: ['UIInteractionSystem'] });
    }
}

export const togglePlugin = new TogglePlugin();
