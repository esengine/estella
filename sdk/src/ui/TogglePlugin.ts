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
import { UIEvents, UIEventQueue } from './UIEvents';

export class TogglePlugin implements Plugin {
    build(app: App): void {
        registerComponent('Toggle', Toggle);

        const world = app.world;

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(UIEvents)],
            (events: UIEventQueue) => {
                const toggleEntities = world.getEntitiesWithComponents([Toggle]);
                for (const entity of toggleEntities) {
                    if (!world.has(entity, Interactable)) {
                        world.insert(entity, Interactable, { enabled: true });
                    }
                    if (!world.has(entity, UIInteraction)) continue;

                    const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                    const toggle = world.get(entity, Toggle) as ToggleData;
                    const interactable = world.get(entity, Interactable) as InteractableData;

                    if (interaction.justPressed && interactable.enabled) {
                        toggle.isOn = !toggle.isOn;
                        events.emit(entity, 'change');
                    }

                    if (toggle.graphicEntity && world.valid(toggle.graphicEntity as Entity)) {
                        const graphicEntity = toggle.graphicEntity as Entity;
                        if (world.has(graphicEntity, Sprite)) {
                            const sprite = world.get(graphicEntity, Sprite) as SpriteData;
                            sprite.color.a = toggle.isOn ? 1 : 0;
                            world.insert(graphicEntity, Sprite, sprite);
                        }
                    }

                    if (toggle.transition && world.has(entity, Sprite)) {
                        const sprite = world.get(entity, Sprite) as SpriteData;
                        const t = toggle.transition;
                        if (!interactable.enabled) {
                            sprite.color = { ...t.disabledColor };
                        } else if (interaction.pressed) {
                            sprite.color = { ...t.pressedColor };
                        } else if (interaction.hovered) {
                            sprite.color = { ...t.hoveredColor };
                        } else {
                            sprite.color = { ...t.normalColor };
                        }
                        world.insert(entity, Sprite, sprite);
                    }
                }
            },
            { name: 'ToggleSystem' }
        ));
    }
}

export const togglePlugin = new TogglePlugin();
