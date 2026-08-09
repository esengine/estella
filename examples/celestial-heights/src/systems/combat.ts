import {
    defineSystem, Query, Mut, Res, Time, Transform, Physics, Commands,
    EventWriter, EventReader, GetWorld,
} from 'esengine';
import { Facing, Health, MeleeAttack, Player } from '../components';
import { DamageDealt, Died } from '../events';
import { POINT_BLANK } from '../config';

const DEG = Math.PI / 180;

/**
 * The one place a swing becomes damage, for the player and for every enemy. The
 * overlap query is the physics world's; `hits` decides who a swing can reach,
 * which is the only difference between Lyra's sword and a wisp's touch.
 */
export const meleeResolveSystem = defineSystem(
    [
        Query(Transform, Facing, Mut(MeleeAttack)),
        Res(Time), Res(Physics), GetWorld(), EventWriter(DamageDealt),
    ],
    (attackers, time, physics, world, damage) => {
        for (const [attacker, transform, facing, attack] of attackers) {
            if (attack.cooldownLeft > 0) attack.cooldownLeft -= time.delta;
            if (!attack.pending) continue;
            attack.pending = false;
            if (attack.cooldownLeft > 0) continue;
            attack.cooldownLeft = attack.cooldown;

            const origin = transform.position;
            const minDot = Math.cos((attack.arcDegrees / 2) * DEG);
            for (const target of physics.overlapCircle(origin, attack.reach, attack.hits)) {
                if (target === attacker || !world.has(target, Transform)) continue;
                const p = world.get(target, Transform).position;
                const dx = p.x - origin.x;
                const dy = p.y - origin.y;
                const dist = Math.hypot(dx, dy);
                if (dist > POINT_BLANK && (dx * facing.x + dy * facing.y) / dist < minDot) continue;
                damage.send({ target, amount: attack.damage, fromX: origin.x, fromY: origin.y });
            }
        }
    },
    { name: 'MeleeResolveSystem' },
);

/** Applies damage, honours invulnerability frames, and announces deaths. */
export const damageSystem = defineSystem(
    [EventReader(DamageDealt), GetWorld(), EventWriter(Died)],
    (blows, world, died) => {
        for (const blow of blows) {
            if (!world.has(blow.target, Health)) continue;
            const health = world.get(blow.target, Health);
            if (health.invulnerable > 0 || health.current <= 0) continue;
            health.current -= blow.amount;
            health.invulnerable = health.invulnerability;
            if (health.current <= 0) {
                health.current = 0;
                died.send({ entity: blow.target, isPlayer: world.has(blow.target, Player) });
            }
        }
    },
    { name: 'DamageSystem' },
);

export const invulnerabilitySystem = defineSystem(
    [Query(Mut(Health)), Res(Time)],
    (bodies, time) => {
        for (const [, health] of bodies) {
            if (health.invulnerable > 0) health.invulnerable -= time.delta;
        }
    },
    { name: 'InvulnerabilitySystem' },
);

/** Enemies leave the world; Lyra's death is the game's business, not a despawn. */
export const deathSystem = defineSystem(
    [EventReader(Died), Commands()],
    (deaths, commands) => {
        for (const death of deaths) {
            if (!death.isPlayer) commands.despawn(death.entity);
        }
    },
    { name: 'DeathSystem' },
);
