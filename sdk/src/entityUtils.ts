import type { Entity } from './types';
import type { World } from './world';
import { Sprite, ShapeRenderer, BitmapText, Disabled } from './component';

export function setEntityVisible(world: World, entity: Entity, visible: boolean): void {
    if (world.has(entity, Sprite)) {
        const sprite = world.get(entity, Sprite);
        sprite.enabled = visible;
        world.insert(entity, Sprite, sprite);
    }
    if (world.has(entity, ShapeRenderer)) {
        const shape = world.get(entity, ShapeRenderer);
        shape.enabled = visible;
        world.insert(entity, ShapeRenderer, shape);
    }
    if (world.has(entity, BitmapText)) {
        const text = world.get(entity, BitmapText);
        text.enabled = visible;
        world.insert(entity, BitmapText, text);
    }
}

export function isEntityVisible(world: World, entity: Entity): boolean {
    if (world.has(entity, Sprite)) {
        return world.get(entity, Sprite).enabled;
    }
    if (world.has(entity, ShapeRenderer)) {
        return world.get(entity, ShapeRenderer).enabled;
    }
    if (world.has(entity, BitmapText)) {
        return world.get(entity, BitmapText).enabled;
    }
    return true;
}

export function setEntityActive(world: World, entity: Entity, active: boolean): void {
    if (active) {
        if (world.has(entity, Disabled)) {
            world.remove(entity, Disabled);
        }
    } else {
        if (!world.has(entity, Disabled)) {
            world.insert(entity, Disabled, {});
        }
    }
}

export function isEntityActive(world: World, entity: Entity): boolean {
    return !world.has(entity, Disabled);
}
