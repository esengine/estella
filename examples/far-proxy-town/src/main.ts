// What moves in the town, and the flight a criterion replays. The flight runs on its own clock, advanced only by frames, and a criterion
// restarts it once the game is paused: two runs that then step the same frames see the same town from the same places, however
// long each took to boot.
import { addSystemToSchedule, Schedule, defineSystem, GetWorld, Res, Time, Transform } from 'esengine';
import type { World, TimeData } from 'esengine';

const CELL = 80;
/** The loop the flyer takes: over the take-off field, the canal, the square, the forest, the mill and the fields. */
const ROUTE: Array<[number, number]> = [
    [1.5, 1.5], [4, 1.2], [7.5, 2], [10.5, 1.5], [10.8, 4.5], [8.5, 6.5], [10.5, 9], [9, 11], [6, 10.5],
    [2.5, 11], [1, 8.5], [2.5, 6.5], [5.5, 4.5], [3, 3],
].map(([x, z]) => [x * CELL, z * CELL]);
/** Seconds for one lap. */
const LAP = 90;
const HEIGHT = 26;

/** Seconds of flight. Restartable from outside, so a run that booted slower is not further along the route. */
let clock = 0;
(globalThis as unknown as { farProxyTown?: { restart(): void } }).farProxyTown = { restart: () => { clock = 0; } };

function along(t: number): { x: number; z: number } {
    const n = ROUTE.length;
    const f = ((t / LAP) % 1) * n;
    const i = Math.floor(f), u = f - i;
    const p = (k: number) => ROUTE[((i + k) % n + n) % n]!;
    const [p0, p1, p2, p3] = [p(-1), p(0), p(1), p(2)];
    const c = (a: number, b: number, c2: number, d: number) =>
        0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u * u + (-a + 3 * b - 3 * c2 + d) * u * u * u);
    return { x: c(p0[0], p1[0], p2[0], p3[0]), z: c(p0[1], p1[1], p2[1], p3[1]) };
}

const flightSystem = defineSystem(
    [Res(Time), GetWorld()],
    (time: TimeData, world: World) => {
        clock += time.delta;
        const at = along(clock);
        const ahead = along(clock + 1.5);
        const yaw = Math.atan2(-(ahead.x - at.x), -(ahead.z - at.z));
        const pitch = -0.32;
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
        const flyer = world.findEntityByName('Flyer');
        if (flyer !== null) {
            world.update(flyer, Transform, (t) => { t.position.x = at.x; t.position.y = HEIGHT; t.position.z = at.z; });
        }
        const camera = world.findEntityByName('Camera');
        if (camera !== null) {
            world.update(camera, Transform, (t) => {
                t.position.x = at.x; t.position.y = HEIGHT; t.position.z = at.z;
                // Yaw about y, then pitch about the turned x.
                t.rotation.x = cy * sp; t.rotation.y = sy * cp; t.rotation.z = -sy * sp; t.rotation.w = cy * cp;
            });
        }
    },
    { name: 'FlightSystem' },
);

/** The mill's sails turn with no body to say they move: the game's own system turns them. */
const sailsSystem = defineSystem(
    [Res(Time), GetWorld()],
    (time: TimeData, world: World) => {
        const hub = world.findEntityByName('Hub');
        if (hub === null) return;
        const a = clock * 0.6;
        world.update(hub, Transform, (t) => { t.rotation.x = 0; t.rotation.y = 0; t.rotation.z = Math.sin(a / 2); t.rotation.w = Math.cos(a / 2); });
    },
    { name: 'SailsSystem' },
);

/** The ferry crosses back and forth on its kinematic body. */
const ferrySystem = defineSystem(
    [Res(Time), GetWorld()],
    (time: TimeData, world: World) => {
        const ferry = world.findEntityByName('Ferry');
        if (ferry === null) return;
        world.update(ferry, Transform, (t) => { t.position.x = 7.5 * CELL + Math.sin(clock * 0.25) * 30; });
    },
    { name: 'FerrySystem' },
);

addSystemToSchedule(Schedule.Update, flightSystem);
addSystemToSchedule(Schedule.Update, sailsSystem);
addSystemToSchedule(Schedule.Update, ferrySystem);
