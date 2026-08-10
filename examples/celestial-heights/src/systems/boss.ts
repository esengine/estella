import {
    defineSystem, Query, Mut, Res, GetWorld,
    Transform, CharacterController, Prefabs, Time, Perception,
    NavAgent, setNavDestination, stopNavAgent,
} from 'esengine';
import type { Entity } from 'esengine';
import { Boss, Charge, Facing, Health, Summoner } from '../components';

/**
 * Vesper's phase, read off her health. Deriving it rather than advancing it on
 * an event means a reloaded fight resumes where the health says it is, and the
 * brain, the HUD bar and this system never disagree about which fight is on.
 */
export const bossPhaseSystem = defineSystem(
    [Query(Mut(Boss), Health)],
    (bosses) => {
        for (const [, boss, health] of bosses) {
            const fraction = health.max > 0 ? health.current / health.max : 0;
            boss.phase = fraction <= 0.35 ? 2 : fraction <= 0.7 ? 1 : 0;
        }
    },
    { name: 'BossPhaseSystem' },
);

/** How far from Vesper the called wisps arrive. */
const SUMMON_RADIUS = 190;

/**
 * Turns a pending call into wisps. The prefab is instantiated through the
 * engine's prefab server, so a called wisp is the same wisp the areas author —
 * one description, whether it was placed or asked for.
 */
export const summonSystem = defineSystem(
    [Query(Transform, Mut(Summoner)), Res(Prefabs), Res(Time)],
    (summoners, prefabs, time) => {
        for (const [, transform, summoner] of summoners) {
            if (summoner.cooldownLeft > 0) summoner.cooldownLeft -= time.delta;
            if (!summoner.pending) continue;
            summoner.pending = false;
            if (summoner.remaining <= 0 || summoner.cooldownLeft > 0 || !summoner.prefab) continue;
            summoner.remaining -= 1;
            summoner.cooldownLeft = summoner.cooldown;

            const origin = { x: transform.position.x, y: transform.position.y };
            for (let i = 0; i < summoner.count; i++) {
                const angle = (Math.PI * 2 * i) / summoner.count + Math.PI / 4;
                void prefabs.instantiate(summoner.prefab, {
                    overrides: [{
                        type: 'property',
                        componentType: 'Transform',
                        propertyName: 'position',
                        value: {
                            x: origin.x + Math.cos(angle) * SUMMON_RADIUS,
                            y: origin.y + Math.sin(angle) * SUMMON_RADIUS * 0.6,
                            z: 0,
                        },
                    }],
                });
            }
        }
    },
    { name: 'SummonSystem' },
);

/**
 * The charge, in three acts: plant and wind up, cross, recover. Navigation is
 * stopped for the crossing — the agent walks the Transform and the controller
 * walks the physics body, and a frame that runs both moves Vesper twice.
 */
export const chargeSystem = defineSystem(
    [
        Query(Mut(Charge), Mut(CharacterController), Mut(Facing), Transform, Perception),
        Res(Time), GetWorld(),
    ],
    (chargers, time, world) => {
        for (const [entity, charge, controller, facing, transform, perception] of chargers) {
            if (charge.cooldownLeft > 0) charge.cooldownLeft -= time.delta;

            if (charge.state === 0) {
                if (!charge.pending) continue;
                charge.pending = false;
                if (charge.cooldownLeft > 0) continue;
                const dx = perception.targetX - transform.position.x;
                const dy = perception.targetY - transform.position.y;
                const length = Math.hypot(dx, dy) || 1;
                charge.dirX = dx / length;
                charge.dirY = dy / length;
                facing.x = charge.dirX;
                facing.y = charge.dirY;
                charge.state = 1;
                charge.timer = charge.windup;
                stopNavAgent(world, entity as Entity);
                controller.velocity.x = 0;
                controller.velocity.y = 0;
                continue;
            }

            charge.timer -= time.delta;
            if (charge.state === 1) {
                controller.velocity.x = 0;
                controller.velocity.y = 0;
                if (charge.timer > 0) continue;
                charge.state = 2;
                charge.timer = charge.dashTime;
                continue;
            }

            controller.velocity.x = charge.dirX * charge.dashSpeed;
            controller.velocity.y = charge.dirY * charge.dashSpeed * 0.6;
            if (charge.timer > 0) continue;
            charge.state = 0;
            charge.cooldownLeft = charge.cooldown;
            controller.velocity.x = 0;
            controller.velocity.y = 0;
            // Hand the body back to navigation where it now stands, rather than
            // leaving it aimed at wherever the chase last pointed it.
            if (world.has(entity as Entity, NavAgent)) {
                setNavDestination(world, entity as Entity, {
                    x: transform.position.x,
                    y: transform.position.y,
                });
            }
        }
    },
    { name: 'ChargeSystem' },
);
