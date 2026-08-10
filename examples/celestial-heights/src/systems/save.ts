import {
    defineSystem, Query, Mut, Res, Commands, GetWorld,
    Input, Transform, Name, SceneManager, Localization, transitionTo,
} from 'esengine';
import { Enemy, Health, Player } from '../components';
import { saves, SLOT, type RunState } from '../save';
import { session } from '../state';

export const saveRunSystem = defineSystem(
    [Query(Transform, Health, Player), Query(Name, Enemy), Res(Input), Res(SceneManager), Res(Localization)],
    (players, living, input, scenes, i18n) => {
        if (!input.isKeyPressed('F5')) return;
        const area = scenes.getActive();
        if (!area) return;
        // Which enemies the scene HAD, minus the ones still standing: a save
        // says what is gone, so a scene that gains an enemy later still spawns it.
        const alive = new Set<string>();
        for (const [, name] of living) alive.add(name.value);
        for (const [, transform, health] of players) {
            saves.save<RunState>(SLOT, {
                area,
                x: transform.position.x,
                y: transform.position.y,
                health: health.current,
                slain: (session.enemiesByArea[area] ?? []).filter((n) => !alive.has(n)),
                locale: i18n.locale,
                pack: { ...session.inventory },
            });
            session.savedAt = Date.now();
            return;
        }
    },
    { name: 'SaveRunSystem' },
);

export const loadRunSystem = defineSystem(
    [Res(Input), Res(SceneManager), Res(Localization)],
    (input, scenes, i18n) => {
        if (!input.isKeyPressed('F9')) return;
        const run = saves.load<RunState>(SLOT);
        if (!run) return;
        i18n.setLocale(run.locale);
        session.inventory = { ...(run.pack ?? {}) };
        session.restore = run;
        session.paused = false;
        if (scenes.getActive() !== run.area) void transitionTo(scenes, run.area, { type: 'fade', duration: 0.25 });
    },
    { name: 'LoadRunSystem' },
);

/**
 * Applies a pending restore once the right area is live. Loading is two acts —
 * the scene arrives asynchronously — so the state waits for its world rather
 * than being written into whichever one happened to be up.
 */
export const applyRestoreSystem = defineSystem(
    [Query(Mut(Transform), Mut(Health), Player), Query(Name, Enemy), Res(SceneManager), Commands(), GetWorld()],
    (players, living, scenes, commands, world) => {
        const run = session.restore;
        if (!run || scenes.getActive() !== run.area || scenes.isTransitioning()) return;
        let placed = false;
        for (const [, transform, health] of players) {
            transform.position.x = run.x;
            transform.position.y = run.y;
            health.current = run.health;
            placed = true;
            break;
        }
        if (!placed) return;
        const slain = new Set(run.slain);
        for (const [entity, name] of living) {
            if (slain.has(name.value)) commands.despawn(entity);
        }
        void world;
        session.restore = null;
    },
    { name: 'ApplyRestoreSystem' },
);

/** Records the enemies an area was authored with, so a save can say what is gone. */
export const rememberRosterSystem = defineSystem(
    [Query(Name, Enemy), Res(SceneManager)],
    (living, scenes) => {
        const area = scenes.getActive();
        if (!area || session.enemiesByArea[area]) return;
        const names: string[] = [];
        for (const [, name] of living) names.push(name.value);
        if (names.length > 0) session.enemiesByArea[area] = names;
    },
    { name: 'RememberRosterSystem' },
);
