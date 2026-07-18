import { defineSystem, Res, GetWorld, Text, TimerRes } from 'esengine';
import type { World, Entity, TextData, TimerManager } from 'esengine';

import { game } from '../state';

const cache = new Map<string, string>();

export const hudSystem = defineSystem(
    [Res(TimerRes), GetWorld()],
    (timers: TimerManager, world: World) => {
        setLabel(world, 'BeatLabel', `Heartbeats: ${game.beats}`);
        setLabel(world, 'SpawnerLabel', spawnerLine());
        setLabel(world, 'StatusLabel', game.status);
        setLabel(
            world, 'ScaleLabel',
            `Timer scale: ${timers.timeScale}× · active timers: ${timers.activeCount}`,
        );
    },
    { name: 'HudSystem' }
);

function spawnerLine(): string {
    const h = game.spawner;
    if (h === null) return 'Spawner: not started';
    if (!h.isActive) return `Spawner: cancelled · spawned ${game.spawned}`;
    const state = game.spawnerPaused ? 'paused' : 'running';
    return `Spawner: ${state} · spawned ${game.spawned} · cycle ${h.elapsed.toFixed(1)}s · fired ${h.repeatCount}×`;
}

function setLabel(world: World, name: string, content: string): void {
    if (cache.get(name) === content) return;
    const entity: Entity | null = world.findEntityByName(name);
    if (entity === null || !world.has(entity, Text)) return;
    const t = world.get(entity, Text) as TextData;
    t.content = content;
    world.insert(entity, Text, t);
    cache.set(name, content);
}
