import {
    defineSystem, Query, Mut, Res,
    registerAction, registerCondition, setNavDestination,
    Nav, NavGrid, Perception, Status,
} from 'esengine';
import { Facing, MeleeAttack } from '../components';
import { ROOM_HALF_W, ROOM_HALF_H } from '../config';

// Leaves for assets/ai/wisp.esbt. The tree is authored as data and resolves
// these names from the engine's AI registry, so the brain's shape is editable
// without touching code and the code stays a vocabulary rather than a plan.

registerCondition('seesPlayer', (ctx) => ctx.has(Perception) && ctx.get(Perception).visible);

registerCondition('inStrikeRange', (ctx) => {
    if (!ctx.has(Perception) || !ctx.has(MeleeAttack)) return false;
    const perception = ctx.get(Perception);
    // Short of the full reach, so the wisp closes in rather than poking from the
    // edge of its own arc.
    return perception.visible && perception.distance <= ctx.get(MeleeAttack).reach * 0.75;
});

registerAction('strike', (ctx) => {
    if (!ctx.has(MeleeAttack)) return Status.Failure;
    ctx.set(MeleeAttack, { ...ctx.get(MeleeAttack), pending: true });
    return Status.Success;
});

registerAction('chase', (ctx) => {
    if (!ctx.has(Perception)) return Status.Failure;
    const perception = ctx.get(Perception);
    if (!perception.visible) return Status.Failure;
    setNavDestination(ctx.world, ctx.entity, { x: perception.targetX, y: perception.targetY });
    return Status.Running;
});

registerAction('hover', () => Status.Running);

/** Whoever can see turns to what they see, so their arc points at it. */
export const perceiverFacingSystem = defineSystem(
    [Query(Mut(Facing), Perception)],
    (perceivers) => {
        for (const [, facing, perception] of perceivers) {
            if (!perception.visible) continue;
            facing.x = perception.dirX;
            facing.y = perception.dirY;
        }
    },
    { name: 'PerceiverFacingSystem' },
);

/** An open grid over the room, until the room is a tilemap to derive one from. */
export const setupNavGridSystem = defineSystem(
    [Res(Nav)],
    (nav) => {
        const cell = 25;
        nav.setGrid(new NavGrid({
            width: (ROOM_HALF_W * 2) / cell,
            height: (ROOM_HALF_H * 2) / cell,
            cellSize: cell,
            origin: { x: -ROOM_HALF_W, y: -ROOM_HALF_H },
        }));
    },
    { name: 'SetupNavGridSystem' },
);
