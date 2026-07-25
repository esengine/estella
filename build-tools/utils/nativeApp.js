// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The app identity an editor export declares, and what each platform calls it.
//
// `app.config.json` sits beside `game.config.json` in an export for a native
// target. The split is deliberate: game.config.json is what the RUNTIME reads to
// play the game; this is what the PACKAGER reads to build an application around
// it. Identity, version and orientation are properties the OS owns — the engine
// can letterbox but cannot rotate a phone — so they are settled here, once, from
// the project, rather than by a flag on whoever happens to run the build.

import path from 'path';
import { existsSync, readFileSync } from 'fs';

/** What the editor writes; see desktop/electron/exportGame.ts NativeAppConfig. */
const DEFAULTS = {
    id: 'com.estella.game',
    name: 'Estella',
    version: '1.0',
    versionCode: 1,
    orientation: 'landscape',
};

/**
 * Read an export's `app.config.json`. Missing or unreadable falls back to the
 * defaults with a warning rather than failing: a content dir produced by an older
 * editor still packages, it just ships a generic identity.
 *
 * @param contentDir Absolute path of the exported project.
 * @param warn       Sink for the "no app.config.json" notice.
 */
export function readAppConfig(contentDir, warn = () => {}) {
    const file = path.join(contentDir, 'app.config.json');
    if (!existsSync(file)) {
        warn(`no app.config.json in ${path.basename(contentDir)} — packaging with a default identity `
            + `(${DEFAULTS.id}). Re-export from the editor to carry the project's own.`);
        return { ...DEFAULTS };
    }
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return {
            id: typeof parsed.id === 'string' && parsed.id ? parsed.id : DEFAULTS.id,
            name: typeof parsed.name === 'string' && parsed.name ? parsed.name : DEFAULTS.name,
            version: typeof parsed.version === 'string' && parsed.version ? parsed.version : DEFAULTS.version,
            versionCode: Number.isInteger(parsed.versionCode) && parsed.versionCode > 0
                ? parsed.versionCode : DEFAULTS.versionCode,
            orientation: parsed.orientation === 'portrait' ? 'portrait' : DEFAULTS.orientation,
        };
    } catch (err) {
        warn(`app.config.json is unreadable (${err.message}) — packaging with a default identity.`);
        return { ...DEFAULTS };
    }
}

/**
 * The manifest value for an orientation. `sensorPortrait` / `sensorLandscape`
 * rather than the plain values: a phone held the other way up still works, but the
 * app never crosses into the aspect it was not designed for. That is what a game
 * ships with — a hard `portrait` leaves an upside-down phone stubbornly rotated.
 */
export function androidScreenOrientation(orientation) {
    return orientation === 'portrait' ? 'sensorPortrait' : 'sensorLandscape';
}

/**
 * The `UISupportedInterfaceOrientations` array for an orientation. iOS has no
 * "sensor" mode: you list the ones you allow, and the OS rotates among them.
 */
export function iosInterfaceOrientations(orientation) {
    return orientation === 'portrait'
        ? ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown']
        : ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];
}

/** Substitute `@NAME@` placeholders in a committed template. */
export function fillTemplate(text, values) {
    return text.replace(/@([A-Z_]+)@/g, (match, key) => (key in values ? String(values[key]) : match));
}
