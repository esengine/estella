import {
    defineSystem, Res,
    registerFsm, registerAction, registerCondition, setNavDestination, Nav, NavGrid, Perception,
} from 'esengine';

// The enemy brain reads the Perception component that the engine's built-in
// perception system writes (sight range + field-of-view over PerceptionTargets),
// so sensing and decision-making stay decoupled — no per-project sensing code.
registerCondition('seesPlayer', ctx => ctx.has(Perception) && ctx.get(Perception).visible);
registerCondition('lostPlayer', ctx => !ctx.has(Perception) || !ctx.get(Perception).visible);

// Patrol until the player is seen, chase while seen, break off when lost.
registerFsm('enemy', {
    initial: 'Patrol',
    states: [
        { name: 'Patrol', transitions: [{ to: 'Chase', condition: 'seesPlayer' }] },
        { name: 'Chase', onUpdate: 'chase', transitions: [{ to: 'Patrol', condition: 'lostPlayer' }] },
    ],
});

// Chase leaf: steer this agent's NavAgent at the last-seen player position. The
// nav layer plans the A* path and moves the body — the action only sets intent.
registerAction('chase', ctx => {
    if (!ctx.has(Perception)) return;
    const per = ctx.get(Perception);
    if (per.visible) setNavDestination(ctx.world, ctx.entity, { x: per.targetX, y: per.targetY });
});

/** Install an open navigation grid over the arena on startup. */
export const setupNavGridSystem = defineSystem(
    [Res(Nav)],
    (nav) => {
        nav.setGrid(new NavGrid({ width: 60, height: 44, cellSize: 20, origin: { x: -600, y: -440 } }));
    },
    { name: 'SetupNavGridSystem' },
);
