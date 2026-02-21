import type { App, Plugin } from '../app';
import { Children, Sprite } from '../component';
import type { ChildrenData, SpriteData } from '../component';
import { defineSystem, Schedule } from '../system';
import { ScreenSpace } from './ScreenSpace';
import { UIRect } from './UIRect';
import type { Entity } from '../types';
import type { World } from '../world';

function assignRenderOrder(world: World, entity: Entity, counter: number): number {
    if (world.has(entity, Sprite) && world.has(entity, UIRect)) {
        const sprite = world.get(entity, Sprite) as SpriteData;
        if (sprite.layer !== counter) {
            sprite.layer = counter;
            world.insert(entity, Sprite, sprite);
        }
        counter++;
    }

    if (!world.has(entity, Children)) return counter;
    const children = world.get(entity, Children) as ChildrenData;
    if (!children || !children.entities) return counter;
    for (const child of children.entities) {
        if (world.valid(child)) {
            counter = assignRenderOrder(world, child, counter);
        }
    }
    return counter;
}

export class UIRenderOrderPlugin implements Plugin {
    build(app: App): void {
        const world = app.world;

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [],
            () => {
                let counter = 0;
                const roots = world.getEntitiesWithComponents([ScreenSpace, UIRect]);
                for (const root of roots) {
                    counter = assignRenderOrder(world, root, counter);
                }
            },
            { name: 'UIRenderOrderSystem' }
        ));
    }
}

export const uiRenderOrderPlugin = new UIRenderOrderPlugin();
