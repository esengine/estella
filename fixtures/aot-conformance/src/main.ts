// The conformance fixture as a game: the same two systems, the same seed world.
// The reporting is game code on purpose — a host-side dump would be a second
// path nobody ships.
import {
    addStartupSystem, addSystemToSchedule, Commands, defineSystem,
    Query, Res, Schedule, Time,
} from 'esengine';

import { Mover, driftSystem, clampSystem } from './systems.generated';
import { SEED } from './seed.generated';

/** Spawned in the order the trace records rows in, which is pool order. */
const spawnSystem = defineSystem(
    [Commands()],
    (cmds) => {
        for (const [x, speed] of SEED) cmds.spawn().insert(Mover, { x, speed, bounces: 0 });
    },
    { name: 'ConfSpawn' },
);

let frame = 0;

/** Last in the schedule, and not `@compiled`: it reads what the two above left.
 *  The delta goes out with the rows because a road that stepped by another one
 *  is a different question from a road that computed the step wrong. */
const reportSystem = defineSystem(
    [Query(Mover), Res(Time)],
    (query, time) => {
        const rows: number[][] = [];
        for (const [, m] of query) rows.push([m.x, m.speed, m.bounces]);
        console.log(`CONF ${frame} ${time.delta} ${JSON.stringify(rows)}`);
        frame++;
    },
    { name: 'ConfReport' },
);

addStartupSystem(spawnSystem);
addSystemToSchedule(Schedule.Update, driftSystem);
addSystemToSchedule(Schedule.Update, clampSystem);
addSystemToSchedule(Schedule.Update, reportSystem);
