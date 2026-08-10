import { registerAction, registerCondition, Perception, Status } from 'esengine';
import { Boss, Charge, Summoner } from '../components';

// Leaves for assets/ai/vesper.esbt. Vesper reuses the wisps' vocabulary for
// seeing, closing and striking — a boss is not a second combat system — and
// adds only what a boss does that a wisp cannot.

registerCondition('canSummon', (ctx) => {
    if (!ctx.has(Boss) || !ctx.has(Summoner)) return false;
    const summoner = ctx.get(Summoner);
    return ctx.get(Boss).phase >= 1 && summoner.remaining > 0 && summoner.cooldownLeft <= 0;
});

registerAction('summon', (ctx) => {
    if (!ctx.has(Summoner)) return Status.Failure;
    ctx.set(Summoner, { ...ctx.get(Summoner), pending: true });
    return Status.Success;
});

registerCondition('canCharge', (ctx) => {
    if (!ctx.has(Boss) || !ctx.has(Charge) || !ctx.has(Perception)) return false;
    const charge = ctx.get(Charge);
    // Too close and the wind-up is unreadable — the charge is a way to cover
    // ground, not a second melee.
    return ctx.get(Boss).phase >= 2 && charge.cooldownLeft <= 0 && charge.state === 0
        && ctx.get(Perception).visible && ctx.get(Perception).distance > 260;
});

registerAction('charge', (ctx) => {
    if (!ctx.has(Charge)) return Status.Failure;
    const charge = ctx.get(Charge);
    if (charge.state !== 0) return Status.Running;
    ctx.set(Charge, { ...charge, pending: true });
    return Status.Running;
});

/** True while a charge is winding up or crossing, so nothing else takes the turn. */
registerCondition('isCharging', (ctx) => ctx.has(Charge) && ctx.get(Charge).state !== 0);
