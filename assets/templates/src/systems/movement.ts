import { defineSystem, Query, Res, Time, LocalTransform } from 'esengine';
import { Velocity } from '../components/movement';

export const movementSystem = defineSystem(
    [Query(LocalTransform, Velocity), Res(Time)],
    (query, time) => {
        for (const [entity, transform, vel] of query) {
            transform.position.x += vel.x * time.delta;
            transform.position.y += vel.y * time.delta;
        }
    }
);
