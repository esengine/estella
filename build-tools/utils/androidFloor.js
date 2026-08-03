// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The Android API floor, read from the one place that declares it.
 *
 * The NDK must build against exactly the manifest's minSdkVersion. Above it,
 * every `__builtin_available` guard compiles out and its symbol becomes a
 * load-time requirement, so the app installs on an older device and then fails
 * before a line of our code runs — which is how a build targeted at android-33
 * shipped a host that could not dlopen below API 31.
 *
 * That coupling used to be a rule someone had to remember while editing four
 * defaults in four files. Reading the number instead means the manifest is the
 * only place it is written, and the two cannot disagree.
 */
import { readFileSync } from 'fs';
import path from 'path';

import config from '../build.config.js';

/** The template every packaged game's manifest is filled from. */
export function manifestTemplatePath() {
    return path.join(config.paths.root, 'native', 'android', 'host', 'AndroidManifest.xml.in');
}

let cached = null;

/** `minSdkVersion` as declared, e.g. 24. */
export function androidMinSdk() {
    if (cached !== null) return cached;
    const template = manifestTemplatePath();
    const found = /android:minSdkVersion="(\d+)"/.exec(readFileSync(template, 'utf8'));
    if (!found) {
        throw new Error(`No android:minSdkVersion in ${template} — it is the single source for `
            + 'the API level the NDK builds against, so a build cannot proceed without it.');
    }
    cached = Number(found[1]);
    return cached;
}

/** The same number as the NDK spells it, e.g. `android-24`. */
export function androidMinPlatform() {
    return `android-${androidMinSdk()}`;
}
