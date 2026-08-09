import {
    defineSystem, Query, Mut, Transform, Sprite, Parent, GetWorld, UIVisual,
} from 'esengine';
import { Health, HealthBarFill, Player, VitalityMeter } from '../components';

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

/**
 * Drives the HUD meter from Lyra's health. The bar is a `Filled` UI visual, so
 * the amount is the whole state — no geometry to keep in step with a layout.
 */
export const vitalityMeterSystem = defineSystem(
    [Query(UIVisual, VitalityMeter), Query(Health, Player), GetWorld()],
    (meters, players, world) => {
        for (const [entity, visual] of meters) {
            for (const [, health] of players) {
                const amount = health.max > 0 ? Math.max(0, health.current / health.max) : 0;
                // ENGINE-GAP(ui-visual-written-at-runtime): writing this every frame
                // dims the bar, so it is written through insert, only on a change.
                if (visual.fillAmount !== amount) {
                    world.insert(entity, UIVisual, { ...visual, fillAmount: amount });
                }
                break;
            }
        }
    },
    { name: 'VitalityMeterSystem' },
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
