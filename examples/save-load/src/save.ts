// Save schema + SaveManager wiring. The schema is versioned: bumping
// SAVE_VERSION requires a migration step from the previous version, so saves
// written by older builds keep loading.
import { SaveManager, Storage } from 'esengine';
import type { SaveEnvelope, SaveMigration } from 'esengine';

export const SAVE_VERSION = 2;
export const SLOT = 'demo';
const KEY_PREFIX = 'save-load:';

/** The shape a v1 build wrote: flat fields, no collected-coin tracking. */
export interface SaveDataV1 {
    points: number;
    playerX: number;
    playerY: number;
}

/** Current (v2) shape. */
export interface SaveData {
    score: number;
    player: { x: number; y: number };
    collected: number[];
}

const migrations: Record<number, SaveMigration> = {
    1: (raw) => {
        const d = raw as SaveDataV1;
        const migrated: SaveData = {
            score: d.points,
            player: { x: d.playerX, y: d.playerY },
            collected: [],
        };
        return migrated;
    },
};

export const saves = new SaveManager({
    version: SAVE_VERSION,
    migrations,
    keyPrefix: KEY_PREFIX,
});

/** Peek at the stored envelope (version / savedAt) without migrating it. */
export function peekEnvelope(): SaveEnvelope<unknown> | undefined {
    return Storage.getJSON<SaveEnvelope<unknown>>(KEY_PREFIX + SLOT);
}

/** Write the slot exactly as an old v1 build would have, to exercise migration. */
export function writeLegacyV1Save(data: SaveDataV1): void {
    Storage.setJSON<SaveEnvelope<SaveDataV1>>(KEY_PREFIX + SLOT, {
        version: 1,
        data,
        savedAt: Date.now(),
    });
}

// A lightweight preference goes through raw Storage — no envelope, no
// versioning, just a typed key/value.
const PREF_ALT_COLOR = 'save-load:pref:alt-color';

export function loadAltColorPref(): boolean {
    return Storage.getBoolean(PREF_ALT_COLOR, false) ?? false;
}

export function saveAltColorPref(value: boolean): void {
    Storage.setBoolean(PREF_ALT_COLOR, value);
}
