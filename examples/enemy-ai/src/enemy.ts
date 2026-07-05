import {
    defineSystem, Query, Res, Transform, GetWorld,
    registerFsm, registerAction, setNavDestination, Nav, NavGrid, AiFsm, StateMachineAgent,
} from 'esengine';
import { PlayerControl } from './components';

// The enemy brain, as data: patrol until the player is sensed, chase while seen,
// break off when lost. `seesPlayer` is a blackboard flag the perception system
// writes; `chase` is a named action resolved from the registry below.
registerFsm('enemy', {
    initial: 'Patrol',
    states: [
        { name: 'Patrol', transitions: [{ to: 'Chase', guard: { key: 'seesPlayer', op: 'truthy' } }] },
        { name: 'Chase', onUpdate: 'chase', transitions: [{ to: 'Patrol', guard: { key: 'seesPlayer', op: 'falsy' } }] },
    ],
});

// Chase leaf: steer this agent's NavAgent at the player's live position. The
// nav layer plans the A* path and moves the body — the action only sets intent.
registerAction('chase', (ctx) => {
    const players = ctx.world.getEntitiesWithComponents([PlayerControl, Transform]);
    const player = players[0];
    if (player === undefined) return;
    const p = ctx.world.get(player, Transform);
    setNavDestination(ctx.world, ctx.entity, { x: p.position.x, y: p.position.y });
});

/** Install an open navigation grid over the arena on startup. */
export const setupNavGridSystem = defineSystem(
    [Res(Nav)],
    (nav) => {
        nav.setGrid(new NavGrid({ width: 60, height: 44, cellSize: 20, origin: { x: -600, y: -440 } }));
    },
    { name: 'SetupNavGridSystem' },
);

const SENSE_RANGE = 180;

/** Perception: set each enemy's `seesPlayer` blackboard flag that the FSM guard reads. */
export const enemySenseSystem = defineSystem(
    [Query(Transform, StateMachineAgent), Res(AiFsm), GetWorld()],
    (enemies, aifsm, world) => {
        const players = world.getEntitiesWithComponents([PlayerControl, Transform]);
        if (players.length === 0) return;
        const pp = world.get(players[0], Transform).position;
        for (const [entity, tf] of enemies) {
            const d = Math.hypot(pp.x - tf.position.x, pp.y - tf.position.y);
            aifsm.blackboard(entity).set('seesPlayer', d < SENSE_RANGE);
        }
    },
    { name: 'EnemySenseSystem' },
);
