import { defineSystem, Query, Mut, GetWorld, Transform } from 'esengine';
import type { TransformData } from 'esengine';
import { LabelOf } from '../components';

// Keeps each floating label a fixed offset above its emitter. Labels are
// separate entities (not children) so they stay upright and unscaled no matter
// what the emitter does.
export const labelSystem = defineSystem(
    [Query(Mut(Transform), LabelOf), GetWorld()],
    (labels, world) => {
        for (const [, transform, label] of labels) {
            if (!world.valid(label.target)) continue;
            const target = world.get(label.target, Transform) as TransformData;
            transform.position.x = target.position.x;
            transform.position.y = target.position.y + label.offsetY;
        }
    },
    { name: 'LabelSystem' },
);
