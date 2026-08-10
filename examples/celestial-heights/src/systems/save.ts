import {
    defineSystem, Query, Mut, Res, Commands, GetWorld,
    Transform, Name, SceneManager, Localization, transitionTo,
} from 'esengine';
import { Enemy, Health, Player } from '../components';
import { saves, SLOT, type RunState } from '../save';
import { Actions } from '../actions';
import { session } from '../state';

export const saveRunSystem = defineSystem(
    [Query(Transform, Health, Player), Query(Name, Enemy), Res(SceneManager), Res(Localization)],
    (players, living, scenes, i18n) => {
        if (!Actions.pressed('Save')) return;
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
    [Res(SceneManager), Res(Localization)],
    (scenes, i18n) => {
        if (!Actions.pressed('Load')) return;
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

/**
 * Carries Lyra's health across a gate. Each area authors its own Lyra at full
 * health, so what she walked in with has to be remembered by the run rather
 * than by the entity — the same reason the pack lives in `session`.
 */
let lastArea = '';

export const vitalitySystem = defineSystem(
    [Query(Mut(Health), Player), Res(SceneManager)],
    (players, scenes) => {
        const area = scenes.getActive();
        if (!area || scenes.isTransitioning()) return;
        for (const [, health] of players) {
            if (area !== lastArea) {
                lastArea = area;
                // Not on a restore — that owns the health it is about to write —
                // and not on nothing, which is what a death left behind: coming
                // back from one is the one arrival that should be at full.
                if (!session.restore && session.vitality !== null && session.vitality > 0) {
                    health.current = Math.min(session.vitality, health.max);
                }
            }
            session.vitality = health.current;
            return;
        }
    },
    { name: 'VitalitySystem' },
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
