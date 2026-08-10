import { Storage } from 'esengine';

/**
 * What the player chose, as opposed to what the run is. Kept apart from the save
 * slot on purpose: settings outlive a run and follow the person, not the game.
 */
export interface Settings {
    locale: string;
    /** Draw hit sparks and the other flourishes. */
    effects: boolean;
}

const KEY = 'celestial-heights.settings';

export const DEFAULTS: Settings = { locale: '', effects: true };

export function loadSettings(): Settings {
    const stored = Storage.getJSON<Partial<Settings>>(KEY);
    return {
        locale: typeof stored?.locale === 'string' ? stored.locale : DEFAULTS.locale,
        effects: typeof stored?.effects === 'boolean' ? stored.effects : DEFAULTS.effects,
    };
}

export function saveSettings(settings: Settings): void {
    Storage.setJSON(KEY, settings);
}
