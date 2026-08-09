import {
    defineSystem, Query, Mut,
    registerAction, registerCondition, setNavDestination,
    Perception, Status,
} from 'esengine';
import { Facing, MeleeAttack } from '../components';

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

