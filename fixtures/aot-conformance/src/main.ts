// The conformance fixture as a game: the same two systems, the same seed world.
// The reporting is game code on purpose — a host-side dump would be a second
// path nobody ships.
import {
    addStartupSystem, addSystemToSchedule, Changed, Commands, defineSystem,
    Query, Res, Schedule, Time,
} from 'esengine';

import {
    Doomed, Mover, Tally, absorbSystem, announceSystem, censusSystem, clampSystem,
    driftSystem, reapSystem, tallySystem,
} from './systems.generated';
import { DOOMED, SEED } from './seed.generated';

/** Spawned in the order the trace records rows in, which is pool order. */
const spawnSystem = defineSystem(
    [Commands()],
    (cmds) => {
        for (const [x, speed] of SEED) cmds.spawn().insert(Mover, { x, speed, bounces: 0 });
        for (const ttl of DOOMED) cmds.spawn().insert(Doomed, { ttl });
    },
    { name: 'ConfSpawn' },
);

let frame = 0;
let ticked = 0;

/** What a `Changed` filter matched this frame: the one duty no value shows. */
const watchSystem = defineSystem(
    [Query(Changed(Mover))],
    (query) => {
        ticked = 0;
        for (const _row of query) ticked++;
    },
    { name: 'ConfWatch' },
);

/** Last in the schedule, and not `@compiled`: it reads what the two above left.
 *  The delta goes out with the rows because a road that stepped by another one
 *  is a different question from a road that computed the step wrong. */
const reportSystem = defineSystem(
    [Query(Mover), Query(Doomed), Res(Time), Res(Tally)],
    (query, doomed, time, tally) => {
        const rows: number[][] = [];
        for (const [, m] of query) rows.push([m.x, m.speed, m.bounces]);
        let alive = 0;
        let ttl = 0;
        for (const [, d] of doomed) { alive++; ttl += d.ttl; }
        console.log(`CONF ${frame} ${time.delta} ${JSON.stringify(rows)} `
            + `${JSON.stringify([tally.bounces, tally.frames, tally.census])} ${ticked} `
            + `${JSON.stringify([alive, ttl])}`);
        frame++;
    },
    { name: 'ConfReport' },
);

addStartupSystem(spawnSystem);
addSystemToSchedule(Schedule.Update, driftSystem);
addSystemToSchedule(Schedule.Update, clampSystem);
addSystemToSchedule(Schedule.Update, tallySystem);
addSystemToSchedule(Schedule.Update, announceSystem);
addSystemToSchedule(Schedule.Update, absorbSystem);
addSystemToSchedule(Schedule.Update, reapSystem);
addSystemToSchedule(Schedule.Update, censusSystem);
addSystemToSchedule(Schedule.Update, watchSystem);
addSystemToSchedule(Schedule.Update, reportSystem);
