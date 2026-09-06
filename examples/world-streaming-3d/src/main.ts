// The gestures a criterion needs and residency must not provide: switching a
// source off, moving one along a boundary, aiming a blow at an entity that is
// gone. Residency itself is declared, and nothing below loads or unloads.
import {
    addSystemToSchedule, Schedule, defineSystem, GetWorld, Res, EventWriter, Time,
    Input, Damage, Transform, WorldStreamingSource, ParticleEmitter,
} from 'esengine';
import type { World, InputState, TimeData, EventWriterInstance, DamagePayload } from 'esengine';

/** Flip a named source on or off. The only thing that changes is who is asking. */
function toggleSource(world: World, name: string): void {
    const entity = world.findEntityByName(name);
    if (entity === null || !world.has(entity, WorldStreamingSource)) return;
    world.update(entity, WorldStreamingSource, (source) => { source.enabled = !source.enabled; });
}

const sourceKeysSystem = defineSystem(
    [Res(Input), GetWorld()],
    (input: InputState, world: World) => {
        if (input.isKeyPressed('KeyK')) toggleSource(world, 'Player');
        if (input.isKeyPressed('KeyL')) toggleSource(world, 'Scout');
        if (input.isKeyPressed('KeyM')) toggleSource(world, 'Bobber');
    },
    { name: 'SourceKeysSystem' },
);

/**
 * Walk the bobber back and forth across a cell's load threshold without ever
 * reaching its unload one. Written by the game because a criterion about the
 * hysteresis band needs a position accurate to the unit, and a key held for a
 * number of frames is not that.
 */
const bobberSystem = defineSystem(
    [Res(Time), GetWorld()],
    (time: TimeData, world: World) => {
        const bobber = world.findEntityByName('Bobber');
        if (bobber === null || !world.has(bobber, WorldStreamingSource)) return;
        if (!world.get(bobber, WorldStreamingSource).enabled) return;
        world.update(bobber, Transform, (transform) => {
            transform.position.z = 2800 + 100 * Math.sin(time.elapsed * 4);
        });
    },
    { name: 'BobberSystem' },
);

/**
 * Aim a blow at an entity remembered from before its cell unloaded, and at one
 * that never leaves.
 *
 * The pair is the point: the canary proves the gesture reached the damage bus,
 * so the enemy being untouched is a handle refused, not a key that did nothing.
 */
const remembered: Record<string, number> = { Enemy: 0, Beacon: 0 };
const staleBlowSystem = defineSystem(
    [Res(Input), GetWorld(), EventWriter(Damage)],
    (input: InputState, world: World, damage: EventWriterInstance<DamagePayload>) => {
        // Remembered ONCE each. Refreshing them is how a test for a stale handle
        // quietly becomes a test for a live one: after the cell comes back the
        // name resolves again, to a different entity.
        for (const name of Object.keys(remembered)) {
            if (remembered[name] !== 0) continue;
            const entity = world.findEntityByName(name);
            if (entity !== null) remembered[name] = entity;
        }
        if (!input.isKeyPressed('KeyJ')) return;
        const player = world.findEntityByName('Player') ?? 0;
        const blow = (target: number): void => {
            if (target !== 0) damage.send({ target, source: player, amount: 25, x: 0, y: 0, z: 0 });
        };
        blow(remembered.Enemy);
        blow(remembered.Beacon);
        blow(world.findEntityByName('Canary') ?? 0);
    },
    { name: 'StaleBlowSystem' },
);

/**
 * Does the reference a cell holds into the persistent world actually name it?
 *
 * Only the game can ask: the value is a runtime handle by the time anything
 * reads it, and one that resolved to nothing looks like one never authored.
 */
const crossRefSystem = defineSystem(
    [GetWorld()],
    (world: World) => {
        const probe = world.findEntityByName('RefProbe');
        const holder = world.findEntityByName('ArchTop');
        if (probe === null) return;
        const answer = holder === null || !world.has(holder, ParticleEmitter)
            ? 0
            : (world.get(holder, ParticleEmitter).subEmitter === world.findEntityByName('Sparks')
                ? 1000 : -1000);
        world.update(probe, Transform, (t) => { t.position.x = answer; });
    },
    { name: 'CrossRefSystem' },
);

addSystemToSchedule(Schedule.Update, sourceKeysSystem);
addSystemToSchedule(Schedule.Update, crossRefSystem);
addSystemToSchedule(Schedule.Update, bobberSystem);
addSystemToSchedule(Schedule.Update, staleBlowSystem);
