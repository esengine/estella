import {
    defineSystem, Query, Mut, Res, EventReader, Achievements, SceneManager,
    Time, Text, UINode, UIDisplay, Localization, GetWorld,
} from 'esengine';
import { Boss, Item, AchievementToast } from '../components';
import { Died } from '../events';
import { session } from '../state';

/**
 * The ids are declared in project.esproject; the runtime refuses an unlock that
 * is not among them, so a typo here is an error rather than a silent no-op on
 * whatever store the game ships against.
 */
export const FIRST_BLOOD = 'first-blood';
export const COLLECTOR = 'collector';
export const WAYFARER = 'wayfarer';
export const SPIRE_CLEARED = 'spire-cleared';

/** How many distinct kinds count as having collected. */
const KINDS_FOR_COLLECTOR = 3;

/** Ids in the order they are announced, so a toast names what just happened. */
const ALL = [FIRST_BLOOD, COLLECTOR, WAYFARER, SPIRE_CLEARED];
const seen = new Set<string>();
let toast = { id: '', left: 0 };

export const achievementSystem = defineSystem(
    [EventReader(Died), Query(Item), Res(Achievements), Res(SceneManager), GetWorld()],
    (deaths, _items, achievements, scenes, world) => {
        for (const death of deaths) {
            if (!death.isPlayer) {
                void achievements.unlock(FIRST_BLOOD);
                // Vesper is despawned with every other enemy, so the death event
                // is the last frame anything can be asked about her.
                if (world.has(death.entity, Boss)) void achievements.unlock(SPIRE_CLEARED);
            }
        }
        const kinds = Object.values(session.inventory).filter((n) => n > 0).length;
        if (kinds >= KINDS_FOR_COLLECTOR) void achievements.unlock(COLLECTOR);
        if (scenes.getActive() === 'moonlit-gallery') void achievements.unlock(WAYFARER);

        // The local provider draws nothing — the engine says so — so an unlock
        // nobody announces is an achievement the player never got.
        for (const id of ALL) {
            if (seen.has(id) || !achievements.unlocked(id)) continue;
            seen.add(id);
            toast = { id, left: TOAST_SECONDS };
        }
    },
    { name: 'AchievementSystem' },
);

const TOAST_SECONDS = 3.5;

export const achievementToastSystem = defineSystem(
    [Query(Mut(UINode), Mut(Text), AchievementToast), Res(Time), Res(Localization)],
    (toasts, time, i18n) => {
        if (toast.left > 0) toast.left -= time.delta;
        const show = toast.left > 0;
        for (const [, node, text] of toasts) {
            const display = show ? UIDisplay.Flex : UIDisplay.None;
            if (node.display !== display) node.display = display;
            if (!show) continue;
            const label = i18n.t(`achievement.${toast.id}`);
            if (text.content !== label) text.content = label;
        }
    },
    { name: 'AchievementToastSystem' },
);
