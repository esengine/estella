// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Does a template archive hold what a template must hold?
//
// The release gate used to check that the asset NAMES were on the release, which
// a zip missing half its contents passes. v0.36.0 published an Android template
// with no precompiled bytecode that way, and every game packaged from it opened
// on a black screen the first time — a failure that reached players before it
// reached us, because nothing between the build and the store looked inside.
//
// The check reads the archive's central directory rather than unpacking it, and
// asks the SAME table the emitter writes from, under release strictness: what a
// contributor's local build may omit, a published template may not.

import { basename } from 'path';
import { readFileSync } from 'fs';
import * as logger from '../utils/logger.js';
import { readZip } from '../utils/zip.js';
import {
    missingTemplateEntries, readTemplateManifest, TEMPLATE_MANIFEST, TEMPLATE_FORMAT,
} from '../utils/nativeTemplate.js';

/** The manifest inside the archive, without unpacking it. */
function manifestOf(entries) {
    const entry = entries.find((e) => e.name === TEMPLATE_MANIFEST);
    if (!entry) return null;
    try {
        return JSON.parse(entry.data.toString('utf8'));
    } catch {
        return null;
    }
}

/**
 * Verify one template archive.
 *
 * @param {string} zipPath
 * @returns {{ok: boolean, problems: string[], platform: string|null, engineVersion: string|null}}
 */
export function verifyTemplateZip(zipPath) {
    const problems = [];
    let entries;
    try {
        entries = readZip(readFileSync(zipPath));
    } catch (err) {
        return { ok: false, problems: [`unreadable archive: ${err.message}`], platform: null, engineVersion: null };
    }

    const manifest = manifestOf(entries);
    if (!manifest) {
        return {
            ok: false,
            problems: [`no readable ${TEMPLATE_MANIFEST} inside`],
            platform: null,
            engineVersion: null,
        };
    }
    if (manifest.kind !== 'estella-native-template') problems.push(`kind is "${manifest.kind}"`);
    if (manifest.formatVersion !== TEMPLATE_FORMAT) {
        problems.push(`formatVersion ${manifest.formatVersion} (this build writes ${TEMPLATE_FORMAT})`);
    }

    const platform = manifest.platform ?? null;
    if (platform !== 'android' && platform !== 'ios') {
        problems.push(`platform "${platform}" is not one this build knows`);
        return { ok: false, problems, platform, engineVersion: manifest.engineVersion ?? null };
    }

    // Under the ABIs the manifest CLAIMS: a template that says it carries two and
    // ships one is the interesting failure, and asking for the ones it lists is
    // what catches it.
    const missing = missingTemplateEntries(entries.map((e) => e.name), platform, {
        abis: manifest.abis, release: true,
    });
    for (const rel of missing) problems.push(`missing ${rel}`);

    return { ok: problems.length === 0, problems, platform, engineVersion: manifest.engineVersion ?? null };
}

/**
 * Verify every archive named, and report. Throws when any fails, so a workflow
 * step fails the job without a second exit-code convention.
 */
export function verifyTemplates(zipPaths) {
    if (zipPaths.length === 0) throw new Error('no template archives to verify');
    let bad = 0;
    for (const zip of zipPaths) {
        const { ok, problems, platform, engineVersion } = verifyTemplateZip(zip);
        const what = `${basename(zip)} (${platform ?? '?'} ${engineVersion ?? '?'})`;
        if (ok) {
            logger.success(`${what}: complete`);
        } else {
            bad++;
            logger.error(`${what}:`);
            for (const p of problems) logger.error(`  ${p}`);
        }
    }
    if (bad > 0) {
        throw new Error(`${bad} of ${zipPaths.length} template archive(s) are incomplete — `
            + 'publishing one ships the failure to every game packaged from it.');
    }
}
