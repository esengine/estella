import {
    defineSystem, Res, ResMut, Query, Mut, GetWorld,
    Time, Transform, MeshRenderer, CharacterController3D,
    type World, type Entity, type TimeData,
} from 'esengine';
import { Physics3D, type Physics3DQueries } from 'esengine/physics3d';
import { Runner, Core, Gate, Checkpoint } from '../components';
import { Run, SPAWN, VOID_Y, MAX_HEALTH, type RunData } from '../resources';

/**
 * Put the runner somewhere. A character's position is physics OUTPUT — the step
 * writes it into Transform every frame — so assigning the Transform here would
 * be overwritten before it was drawn. `teleportCharacter` is the way to say it.
 */
function place(world: World, queries: Physics3DQueries | null,
               runner: Entity, to: { x: number; y: number; z: number }): void {
    queries?.teleportCharacter(runner, to);
    world.update(runner, CharacterController3D, (c) => {
        c.velocity.x = 0; c.velocity.y = 0; c.velocity.z = 0;
    });
}

/**
 * The four states a run is ever in, and the two ways out of each. Pause stops
 * time itself rather than the systems that read it: a paused world whose physics
 * kept stepping would drift under a menu nobody is touching.
 */
export const lifecycleSystem = defineSystem(
    [
        GetWorld(), ResMut(Run), ResMut(Time), Res(Physics3D),
        Query(Transform, Runner),
        Query(Mut(Core), Mut(MeshRenderer)),
        Query(Mut(Gate), Mut(MeshRenderer)),
        Query(Mut(Checkpoint)),
    ],
    (world, runMut, timeMut, queries, runners, cores, gates, checkpoints) => {
        const run = runMut.get() as RunData;
        const time = timeMut.get() as TimeData;

        let runner: Entity | null = null;
        let at: { x: number; y: number; z: number } | null = null;
        for (const [entity, transform] of runners) { runner = entity; at = transform.position; }

        // Restart is available from every state, including the two that end it.
        if (run.restartPressed) {
            run.phase = 'playing';
            run.health = MAX_HEALTH;
            run.cores = 0;
            run.elapsed = 0;
            run.respawn = { ...SPAWN };
            for (const [, core, mesh] of cores) { core.taken = false; mesh.enabled = true; }
            for (const [, gate, mesh] of gates) { gate.open = false; mesh.enabled = true; }
            for (const [, point] of checkpoints) point.reached = false;
            if (runner !== null) place(world, queries, runner, SPAWN);
            time.scale = 1;
            return;
        }

        if (run.phase === 'playing') {
            if (run.pausePressed) { run.phase = 'paused'; time.scale = 0; return; }
            const drowned = at !== null && at.y < VOID_Y;
            if (run.health <= 0 || drowned) {
                run.phase = 'dead';
                run.health = 0;
                time.scale = 0;
            }
            return;
        }

        if (run.phase === 'paused') {
            if (run.pausePressed) { run.phase = 'playing'; time.scale = 1; }
            return;
        }

        if (run.phase === 'dead') {
            // Space, not R: the run continues from the last checkpoint, and the
            // cores already taken stay taken. R is the whole level again.
            if (!run.interactPressed) return;
            run.phase = 'playing';
            run.health = MAX_HEALTH;
            if (runner !== null) place(world, queries, runner, run.respawn);
            time.scale = 1;
        }
    },
    { name: 'LifecycleSystem' },
);
