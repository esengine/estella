import {
    defineSystem, Query, Mut, Transform, Sprite, Parent, GetWorld, UIVisual, UINode, UIDisplay,
} from 'esengine';
import {
    Boss, BossMeter, BossPanel, Health, HealthBarFill, Player, VitalityMeter,
} from '../components';

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
    [Query(Mut(UIVisual), VitalityMeter), Query(Health, Player)],
    (meters, players) => {
        for (const [, visual] of meters) {
            for (const [, health] of players) {
                visual.fillAmount = health.max > 0 ? Math.max(0, health.current / health.max) : 0;
                break;
            }
        }
    },
    { name: 'VitalityMeterSystem' },
);

/**
 * Shows the boss bar while an area has a boss in it, and reports its health.
 * The bar lives in the shared HUD, so it is the presence of a boss that decides
 * whether it is on screen — not which scene is loaded.
 */
export const bossMeterSystem = defineSystem(
    [Query(Mut(UIVisual), BossMeter), Query(Mut(UINode), BossPanel), Query(Health, Boss)],
    (meters, panels, bosses) => {
        let fraction = -1;
        for (const [, health] of bosses) {
            fraction = health.max > 0 ? Math.max(0, health.current / health.max) : 0;
            break;
        }
        const display = fraction < 0 ? UIDisplay.None : UIDisplay.Flex;
        for (const [, node] of panels) {
            if (node.display !== display) node.display = display;
        }
        if (fraction < 0) return;
        for (const [, visual] of meters) visual.fillAmount = fraction;
    },
    { name: 'BossMeterSystem' },
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
