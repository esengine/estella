import {
    defineSystem, Res, ResMut, Query, Mut,
    Time, Transform, MeshRenderer,
    type TimeData,
} from 'esengine';
import { Runner, Hazard, Core, Gate, Reachable } from '../components';
import { Run, CORES_NEEDED, type RunData } from '../resources';

/** Square distance on the ground plane — height is not what "near" means here. */
function groundDistance2(a: { x: number; z: number }, b: { x: number; z: number }): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
}

/** A core bobs, so a thing worth walking to reads as one from across the plaza. */
export const coreBobSystem = defineSystem(
    [Res(Time), Query(Mut(Core), Mut(Transform))],
    (time: TimeData, cores) => {
        for (const [, core, at] of cores) {
            if (core.taken) continue;
            core.spin += time.delta * 2;
            at.position.y += Math.cos(core.spin) * time.delta * 18;
        }
    },
    { name: 'CoreBobSystem' },
);

/** Scorched floor: standing on it costs health for as long as you stand there. */
export const hazardSystem = defineSystem(
    [Res(Time), ResMut(Run), Query(Transform, Runner), Query(Hazard, Transform)],
    (time: TimeData, runMut, runners, hazards) => {
        const run = runMut.get() as RunData;
        if (run.phase !== 'playing') return;
        for (const [, at] of runners) {
            for (const [, zone, origin] of hazards) {
                if (Math.abs(at.position.x - origin.position.x) > zone.halfX) continue;
                if (Math.abs(at.position.z - origin.position.z) > zone.halfZ) continue;
                // Vertical: only the floor you are ON burns, not one two storeys down.
                if (Math.abs(at.position.y - origin.position.y) > 120) continue;
                run.health = Math.max(0, run.health - zone.damagePerSecond * time.delta);
            }
        }
    },
    { name: 'HazardSystem' },
);

/**
 * What E would do here, and what it does when pressed. The prompt and the act
 * are one pass: a prompt computed somewhere else drifts from the thing it
 * offers the moment either one moves.
 */
export const interactSystem = defineSystem(
    [
        ResMut(Run), Query(Transform, Runner),
        Query(Mut(Core), Mut(MeshRenderer), Transform, Reachable),
        Query(Mut(Gate), Mut(MeshRenderer), Transform, Reachable),
    ],
    (runMut, runners, cores, gates) => {
        const run = runMut.get() as RunData;
        run.prompt = '';
        if (run.phase !== 'playing') return;

        let at: { x: number; z: number } | null = null;
        for (const [, transform] of runners) at = transform.position;
        if (!at) return;

        for (const [, core, mesh, transform, reach] of cores) {
            if (core.taken || groundDistance2(at, transform.position) > reach.radius * reach.radius) continue;
            run.prompt = `E — ${reach.prompt}`;
            if (!run.interactPressed) continue;
            core.taken = true;
            mesh.enabled = false;
            run.cores += 1;
            run.interactPressed = false;
            return;
        }

        for (const [, gate, mesh, transform, reach] of gates) {
            if (gate.open || groundDistance2(at, transform.position) > reach.radius * reach.radius) continue;
            if (run.cores < CORES_NEEDED) {
                run.prompt = `the gate wants ${CORES_NEEDED - run.cores} more core(s)`;
                continue;
            }
            run.prompt = `E — ${reach.prompt}`;
            if (!run.interactPressed) continue;
            gate.open = true;
            mesh.enabled = false;
            run.phase = 'won';
            run.interactPressed = false;
        }
    },
    { name: 'InteractSystem' },
);
