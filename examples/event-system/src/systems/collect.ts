import {
    defineSystem, Query, Res, Time, Commands, EventWriter,
    Transform, Sprite,
} from 'esengine';
import { Collectible } from '../components';
import { CollectEventDef } from '../events';

const COLLECT_LIFETIME = 5;

export const collectSystem = defineSystem(
    [Query(Transform, Sprite, Collectible), Res(Time), Commands(), EventWriter(CollectEventDef)],
    (query, time, cmds, writer) => {
        for (const [entity, _transform, sprite, collectible] of query) {
            const age = COLLECT_LIFETIME - (sprite.color.a > 0.1 ? COLLECT_LIFETIME : 0);

            sprite.color.a -= time.delta * 0.2;

            if (sprite.color.a <= 0) {
                writer.send({ points: collectible.points });
                cmds.despawn(entity);
            }
        }
    },
    { name: 'CollectSystem' }
);
