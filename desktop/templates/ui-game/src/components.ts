// The declaration entry: components AND the named actions the scene's event rows
// call. The editor reads this module to fill its palettes, so an action declared
// here is one an Events row can pick from a dropdown.
import {
    defineComponent, registerAction, setControllerPage, UIController,
} from 'esengine';

export const HudField = { Score: 0, Time: 1, Final: 2 } as const;

export const GameState = defineComponent('GameState', {
    score: 0,
    timeLeft: 0,
    running: false,
});

export const HudLabel = defineComponent('HudLabel', { field: 0 }, {
    fields: {
        field: {
            enum: [
                { label: 'Score', value: HudField.Score },
                { label: 'Time left', value: HudField.Time },
                { label: 'Final score', value: HudField.Final },
            ],
        },
    },
});

registerAction('game.start', {
    params: [{ name: 'seconds', type: 'number', min: 5, max: 120, step: 5 }],
    run: (ctx, _bb, _arg, params) => {
        if (!ctx.has(GameState)) return;
        const state = ctx.get(GameState);
        state.score = 0;
        state.timeLeft = typeof params?.seconds === 'number' ? params.seconds : 15;
        state.running = true;
        ctx.set(GameState, state);
    },
});

registerAction('game.hit', (ctx) => {
    if (!ctx.has(GameState)) return;
    const state = ctx.get(GameState);
    if (!state.running) return;
    state.score += 1;
    ctx.set(GameState, state);
});

registerAction('game.jump', (ctx) => {
    if (!ctx.has(UIController)) return;
    const slots = ctx.get(UIController).controllers.find((c) => c.name === 'slots');
    if (!slots) return;
    const others = slots.pages.filter((page) => page !== slots.current);
    const next = others[Math.floor(Math.random() * others.length)];
    if (next) setControllerPage(ctx.world, ctx.entity, 'slots', next);
});
