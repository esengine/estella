import { defineSystem, GetWorld, Text } from 'esengine';
import type { World, Entity, TextData } from 'esengine';
import { game } from '../state';

let lastScore = '';
let lastStatus = '';

export const hudSystem = defineSystem(
    [GetWorld()],
    (world: World) => {
        const score = `Score: ${game.score}`;
        if (score !== lastScore && setLabel(world, 'ScoreLabel', score)) lastScore = score;
        if (game.status !== lastStatus && setLabel(world, 'StatusLabel', game.status)) {
            lastStatus = game.status;
        }
    },
    { name: 'HudSystem' }
);

function setLabel(world: World, name: string, content: string): boolean {
    const entity: Entity | null = world.findEntityByName(name);
    if (entity === null || !world.has(entity, Text)) return false;
    const t = world.get(entity, Text) as TextData;
    t.content = content;
    world.insert(entity, Text, t);
    return true;
}
