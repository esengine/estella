import {
    defineSystem, Query, Mut, Transform, Sprite, Parent, GetWorld,
} from 'esengine';
import { Health, HealthBarFill } from '../components';

/**
 * Shrinks a bar towards its left edge. Scaling would take it in from both
 * sides, which reads as the bar moving rather than draining, so the width is
 * set and the position walks half the difference back.
 */
export const healthBarSystem = defineSystem(
    [Query(Mut(Transform), Mut(Sprite), HealthBarFill, Parent), GetWorld()],
    (bars, world) => {
        for (const [, transform, sprite, bar, parent] of bars) {
            if (!world.has(parent.entity, Health)) continue;
            const health = world.get(parent.entity, Health);
            const fraction = health.max > 0 ? Math.max(0, health.current / health.max) : 0;
            const width = bar.width * fraction;
            sprite.size.x = width;
            transform.position.x = -(bar.width - width) / 2;
        }
    },
    { name: 'HealthBarSystem' },
);

/** Blinks whoever is in invulnerability frames, so a hit is visible at all. */
export const hitFlashSystem = defineSystem(
    [Query(Mut(Sprite), Health)],
    (bodies) => {
        for (const [, sprite, health] of bodies) {
            sprite.color.a = health.invulnerable > 0
                ? (Math.floor(health.invulnerable * 12) % 2 === 0 ? 0.3 : 1)
                : 1;
        }
    },
    { name: 'HitFlashSystem' },
);
