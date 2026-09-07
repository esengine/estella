// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-release-manifest-refs.mjs — the updater's manifests name files
 *        the release actually carries.
 *
 * The completeness check beside this one asks whether a hand-kept list of names
 * is present. That answers "did we remember to list it", not "does what we
 * published hold together": the macOS zip is what Squirrel.Mac installs from,
 * and it was on no list at all, so a release missing it would have passed while
 * every macOS auto-update failed at the last step.
 *
 * The contract is referential, not structural. latest.yml and latest-mac.yml
 * name the files electron-updater will fetch, resolved against the same
 * directory; anything they name has to be there. That survives electron-builder
 * changing an artifact name, an arch suffix or a channel, none of which a fixed
 * list would.
 *
 *   node tools/check-release-manifest-refs.mjs --assets <file> --manifests <dir>
 *
 * `--assets` is one asset name per line, as the release holds them.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : null;
};

const assetsFile = opt('--assets');
const manifestDir = opt('--manifests');
if (!assetsFile || !manifestDir) {
    console.error('usage: --assets <file with one asset name per line> --manifests <dir>');
    process.exit(2);
}

const assets = new Set(readFileSync(assetsFile, 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter(Boolean));

/**
 * What a manifest points at. electron-updater writes the file it will fetch as
 * `path:` and each entry of `files:` as `url:`; both are plain names resolved
 * beside the manifest. A url is percent-encoded, so it is decoded before it is
 * compared against what the store lists.
 */
function referencedBy(text) {
    const out = new Set();
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s*(?:-\s*)?(?:url|path):\s*(.+?)\s*$/.exec(line);
        if (!m) continue;
        let name = m[1].replace(/^["']|["']$/g, '');
        try { name = decodeURIComponent(name); } catch { /* leave it as written */ }
        // Only the downloadable payloads; a manifest also carries hashes and dates.
        if (/\.(exe|dmg|zip|AppImage|blockmap)$/i.test(name)) out.add(name);
    }
    return out;
}

const problems = [];
const manifests = existsSync(manifestDir)
    ? readdirSync(manifestDir).filter((f) => /^latest[^/]*\.yml$/i.test(f))
    : [];

if (manifests.length === 0) {
    problems.push(`no latest*.yml in ${manifestDir} — the updater feed is what this checks, and `
        + `a release with no feed is one no installed editor can update from.`);
}

let checked = 0;
for (const file of manifests) {
    const refs = referencedBy(readFileSync(path.join(manifestDir, file), 'utf8'));
    if (refs.size === 0) {
        problems.push(`${file} names no downloadable file — electron-updater would have nothing `
            + `to fetch, which is not something the release's asset list can show.`);
    }
    for (const ref of refs) {
        checked++;
        if (!assets.has(ref)) {
            problems.push(`${file} points at "${ref}" and the release has no such asset. `
                + `An installed editor reading this feed fetches a 404 at the last step.`);
        }
    }
}

if (problems.length) {
    console.error('check-release-manifest-refs: the updater feed and the release disagree.\n');
    for (const p of problems) console.error(`  ✗ ${p}\n`);
    process.exit(1);
}

console.log(`check-release-manifest-refs: ${manifests.length} manifest(s), ${checked} reference(s) — `
    + `every file the updater will fetch is in the release.`);
