import {
    defineSystem, Res,
    registerAction, registerCondition, setNavDestination, Nav, NavGrid, Perception,
} from 'esengine';

// Leaf actions/conditions shared by BOTH brains — the state machine
// (assets/ai/enemy.esfsm) and the behavior tree (assets/ai/enemy.esbt) resolve
// these names from the same registry. The graphs are authored in the editor;
// the scene's StateMachineAgent.fsm / BehaviorTreeAgent.bt point at the asset
// paths, and the engine loads them (no registerFsm/registerBt in code).
registerCondition('seesPlayer', ctx => ctx.has(Perception) && ctx.get(Perception).visible);
registerCondition('lostPlayer', ctx => !ctx.has(Perception) || !ctx.get(Perception).visible);

registerAction('chase', ctx => {
    if (!ctx.has(Perception)) return;
    const per = ctx.get(Perception);
    if (per.visible) setNavDestination(ctx.world, ctx.entity, { x: per.targetX, y: per.targetY });
});
registerAction('patrol', () => { /* hold position until the player is seen */ });

/** Install an open navigation grid over the arena on startup. */
export const setupNavGridSystem = defineSystem(
    [Res(Nav)],
    (nav) => {
        nav.setSurface(new NavGrid({ width: 60, height: 44, cellSize: 20, origin: { x: -600, y: -440 } }));
    },
    { name: 'SetupNavGridSystem' },
);
