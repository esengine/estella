import { DEFAULT_PIXELS_PER_UNIT } from 'esengine';
import type { EntityDataLike } from '../math/Transform';

export type SizeProvider = 'UIRect' | 'Sprite' | null;

export function getSizeProvider(entity: EntityDataLike): SizeProvider {
    if (entity.components.some(c => c.type === 'UIRect')) return 'UIRect';
    if (entity.components.some(c => c.type === 'Sprite')) return 'Sprite';
    return null;
}

export function findScenePixelsPerUnit(
    entities: Iterable<EntityDataLike>,
    defaultValue: number = DEFAULT_PIXELS_PER_UNIT,
): number {
    for (const entity of entities) {
        const canvas = entity.components.find(c => c.type === 'Canvas');
        if (canvas) {
            return (canvas.data.pixelsPerUnit as number) || defaultValue;
        }
    }
    return defaultValue;
}
