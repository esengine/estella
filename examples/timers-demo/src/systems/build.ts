// Wires the whole playground: schedules the heartbeat + spawner intervals and
// builds the buttons that drive one-shot delays, a limited-repeat countdown,
// TimerHandle control (pause/resume/cancel/reset) and the global timeScale.
import {
    defineSystem, Res, GetWorld,
    UIEvents, TimerRes, Transform, Sprite,
    createButton, themeColors, px,
} from 'esengine';
import type {
    Entity, World, Color, ThemeColors, UIEventQueue, TimerManager,
} from 'esengine';

import { Heart, Spark, Drifter } from '../components';
import { game } from '../state';

const BTN_H = 32;

const SPARK_COLORS: ReadonlyArray<Color> = [
    { r: 0.98, g: 0.8, b: 0.2, a: 1 },
    { r: 0.92, g: 0.28, b: 0.38, a: 1 },
    { r: 0.28, g: 0.54, b: 0.92, a: 1 },
    { r: 0.28, g: 0.92, b: 0.54, a: 1 },
    { r: 0.79, g: 0.28, b: 0.92, a: 1 },
];

export const buildSystem = defineSystem(
    [Res(UIEvents), Res(TimerRes), GetWorld()],
    (events: UIEventQueue, timers: TimerManager, world: World) => {
        if (game.built) return;

        const fxRow = world.findEntityByName('FxRow');
        const spawnerRow = world.findEntityByName('SpawnerRow');
        const scaleRow = world.findEntityByName('ScaleRow');
        if (fxRow === null || spawnerRow === null || scaleRow === null) return;
        game.built = true;

        // interval(seconds, cb): first fire after `seconds`, then every
        // `seconds`. The heartbeat replaces the classic "phase += time.delta;
        // if (phase >= BEAT) { phase -= BEAT; … }" accumulator system.
        timers.interval(0.8, () => {
            game.beats += 1;
            kickHeart(world);
        });

        startSpawner(world, timers);

        const c = themeColors();

        button(world, events, fxRow, c, true, 'Firework in 1s', 128, () => {
            game.status = 'Fuse lit — bursting in 1 second…';
            timers.delay(1, () => burstFirework(world, timers));
        });
        button(world, events, fxRow, c, false, 'Countdown ×3', 118, () => {
            // maxRepeat = 3: fires at t=1s, 2s, 3s, then removes itself —
            // isActive flips to false without any cancel() call.
            if (game.countdown?.isActive) return;
            game.status = 'Countdown: 3…';
            game.countdown = timers.interval(1, (t) => {
                // Inside a callback, repeatCount is the number of PREVIOUS
                // fires (it increments after the callback returns).
                const remaining = 2 - t.repeatCount;
                if (remaining > 0) {
                    game.status = `Countdown: ${remaining}…`;
                } else {
                    game.status = 'Lift-off!';
                    burstFirework(world, timers);
                }
            }, 3);
        });

        button(world, events, spawnerRow, c, false, 'Pause', 92, () => {
            if (!game.spawner?.isActive) return;
            game.spawner.pause();
            game.spawnerPaused = true;
            game.status = 'Spawner paused — its elapsed clock freezes.';
        });
        button(world, events, spawnerRow, c, false, 'Resume', 92, () => {
            if (!game.spawner?.isActive) return;
            game.spawner.resume();
            game.spawnerPaused = false;
            game.status = 'Spawner resumed from where it froze.';
        });
        button(world, events, spawnerRow, c, false, 'Cancel', 92, () => {
            game.spawner?.cancel();
            game.spawnerPaused = false;
            game.status = 'Spawner cancelled — the handle is dead (isActive = false).';
        });
        button(world, events, spawnerRow, c, false, 'Restart', 92, () => {
            if (game.spawner?.isActive) {
                // reset() rewinds elapsed + repeatCount on a live timer.
                game.spawner.reset();
                game.spawner.resume();
                game.spawnerPaused = false;
                game.status = 'Live spawner reset() — cycle rewound to 0.';
            } else {
                // A cancelled handle cannot be revived; schedule a new timer.
                startSpawner(world, timers);
                game.status = 'Cancelled handle cannot restart — scheduled a new interval.';
            }
        });

        for (const scale of [0.5, 1, 2]) {
            button(world, events, scaleRow, c, false, `${scale}×`, 56, () => {
                timers.timeScale = scale;
                game.status = `TimerManager.timeScale = ${scale} — all timers, not Time.delta.`;
            });
        }
    },
    { name: 'BuildSystem' },
);

function startSpawner(world: World, timers: TimerManager): void {
    game.spawnerPaused = false;
    game.spawner = timers.interval(0.7, () => spawnDrifter(world, timers));
}

function spawnDrifter(world: World, timers: TimerManager): void {
    game.spawned += 1;
    const x = -360 + Math.random() * 720;
    const entity = world.spawn('Drifter');
    world.insert(entity, Transform, { position: { x, y: 340, z: 0 } });
    world.insert(entity, Sprite, {
        size: { x: 22, y: 22 },
        color: { ...SPARK_COLORS[game.spawned % SPARK_COLORS.length] },
    });
    world.insert(entity, Drifter, {
        vy: -(90 + Math.random() * 60),
        baseX: x,
        phase: Math.random() * Math.PI * 2,
    });

    // delay() as entity lifetime — no per-entity age accumulator. Timers are
    // app-scoped and outlive entities, so guard against the entity having been
    // despawned by something else before the timer fires.
    timers.delay(7, () => {
        if (world.valid(entity)) world.despawn(entity);
    });
}

function burstFirework(world: World, timers: TimerManager): void {
    const cx = -160 + Math.random() * 320;
    const cy = -220 + Math.random() * 160;
    const sparks: Entity[] = [];

    for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2;
        const speed = 160 + Math.random() * 80;
        const entity = world.spawn('Spark');
        world.insert(entity, Transform, { position: { x: cx, y: cy, z: 0 } });
        world.insert(entity, Sprite, {
            size: { x: 14, y: 14 },
            color: { ...SPARK_COLORS[i % SPARK_COLORS.length] },
        });
        world.insert(entity, Spark, {
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
        });
        sparks.push(entity);
    }

    timers.delay(1.4, () => {
        for (const entity of sparks) {
            if (world.valid(entity)) world.despawn(entity);
        }
    });
}

function kickHeart(world: World): void {
    const heart = world.findEntityByName('Heart');
    if (heart === null || !world.has(heart, Transform)) return;
    const beat = world.get(heart, Heart);
    const t = world.get(heart, Transform);
    t.scale.x = beat.beatScale;
    t.scale.y = beat.beatScale;
    world.insert(heart, Transform, t);
}

function button(
    world: World, events: UIEventQueue, parent: Entity, c: ThemeColors,
    primary: boolean, label: string, width: number, onClick: () => void,
): void {
    const states = primary
        ? { normal: { color: c.primary }, hover: { color: c.primaryHover }, pressed: { color: c.primaryActive } }
        : { normal: { color: c.control }, hover: { color: c.controlHover }, pressed: { color: c.controlActive } };
    createButton({
        world, events, parent,
        node: { width: px(width), height: px(BTN_H) },
        states,
        text: { content: label, color: c.onPrimary, fontSize: 14 },
        onClick,
    });
}
