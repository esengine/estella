// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-release-artifact-names.mjs — one identity per published desktop
 *        artifact, spelled the same by everything that names it.
 *
 * Six things name these files: electron-builder, the GitHub asset store, the
 * blockmap derived beside each one, mirror-release's globs, the completeness
 * check, and the updater manifests. They agreed by accident until one did not.
 *
 * `productName` is "Estella Editor". electron-builder sanitised the space out of
 * three macOS artifacts and left it in the zip's blockmap, GitHub stores a
 * spaced name with dots, and the publisher's own dedup then looked for a name
 * the store does not have — so re-uploading returned 422 and every retry of a
 * macOS publish failed on that one file. The retry loop's premise, "the whole
 * command is idempotent", was a conditional nobody had tested.
 *
 * So the rule is not "fix the blockmap". It is that a published desktop artifact
 * has a declared name, that name has no whitespace, and no two survive GitHub's
 * normalisation as the same string.
 *
 *   node tools/check-release-artifact-names.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'desktop', 'electron-builder.yml');
const MIRROR = path.join(ROOT, '.github', 'workflows', 'mirror-release.yml');
const RELEASE = path.join(ROOT, '.github', 'workflows', 'release-desktop.yml');

if (!existsSync(CONFIG)) {
    console.log('check-release-artifact-names: no desktop/electron-builder.yml — the editor '
        + 'submodule is not checked out here. Nothing judged.');
    process.exit(0);
}

/**
 * What GitHub stores an uploaded asset as. It replaces each whitespace run with
 * a single dot, which is the step that made a spaced name unfindable by the
 * publisher that wrote it.
 */
const asStored = (name) => name.replace(/\s+/g, '.');

const problems = [];
const lines = readFileSync(CONFIG, 'utf8').split(/\r?\n/);

/**
 * Enough of the config to answer this question, parsed by hand: tools/ carries no
 * YAML dependency, and check-suite-preconditions reads workflows the same way.
 * Comments and blank lines are dropped; only the keys below are understood.
 */
function readConfig() {
    const out = { productName: null, nsis: null, mac: [] };
    let top = null;                 // the column-0 key we are inside
    let item = null;                // the current `- target:` entry
    for (const raw of lines) {
        if (!raw.trim() || /^\s*#/.test(raw)) continue;
        const indent = raw.length - raw.trimStart().length;
        const line = raw.trim();
        if (indent === 0) {
            if (item) { out.mac.push(item); item = null; }
            top = line.split(':')[0];
            const pn = /^productName:\s*(.+)$/.exec(line);
            if (pn) out.productName = pn[1].trim().replace(/^["']|["']$/g, '');
            continue;
        }
        const kv = /^-?\s*([A-Za-z]+):\s*(.*)$/.exec(line);
        if (!kv) continue;
        const [, key, value] = kv;
        if (top === 'nsis' && key === 'artifactName') out.nsis = value.trim();
        if (top === 'mac') {
            if (line.startsWith('- target:')) {
                if (item) out.mac.push(item);
                item = { target: value.trim(), artifactName: null };
            } else if (item && key === 'artifactName') {
                item.artifactName = value.trim();
            }
        }
    }
    if (item) out.mac.push(item);
    return out;
}

const cfg = readConfig();

/** Every target the release matrix actually publishes, with its declared name. */
const declared = cfg.mac.map((t) => ({ where: `mac/${t.target}`, name: t.artifactName }));
declared.push({ where: 'nsis', name: cfg.nsis });

// 1. Declared at all. An undeclared name is electron-builder's opinion of
//    productName, and that opinion is not the same for every target.
for (const d of declared) {
    if (!d.name) {
        problems.push(
            `${d.where} declares no artifactName, so its published filename is derived from `
            + `productName (${JSON.stringify(cfg.productName)}). Whether the space survives is `
            + `then a property of electron-builder rather than of this repo.`);
    }
}

// 2. No whitespace — in the template or in what it can expand to. The version
//    and arch placeholders cannot introduce one; a literal can.
for (const d of declared.filter((x) => x.name)) {
    if (/\s/.test(d.name)) {
        problems.push(
            `${d.where} artifactName "${d.name}" contains whitespace. GitHub stores it with `
            + `dots, the publisher looks it up with spaces, and re-upload is a 422 forever.`);
    }
    if (/\$\{productName\}/.test(d.name)) {
        problems.push(
            `${d.where} artifactName interpolates \${productName}, which is `
            + `${JSON.stringify(cfg.productName)} — the whitespace this rule exists to keep out.`);
    }
}

// 3. Collision-free after the store's normalisation. Two names that differ only
//    where GitHub does not is one asset overwriting the other, silently.
{
    const expanded = declared.filter((x) => x.name).flatMap((d) => {
        const base = d.name.replace(/\$\{version\}/g, '0.0.0').replace(/\$\{arch\}/g, 'arm64')
            .replace(/\$\{ext\}/g, d.where.includes('dmg') ? 'dmg' : d.where.includes('zip') ? 'zip' : 'exe');
        // The blockmap is derived beside the artifact and is published too.
        return [{ where: d.where, file: base }, { where: `${d.where} blockmap`, file: `${base}.blockmap` }];
    });
    const seen = new Map();
    for (const e of expanded) {
        const key = asStored(e.file);
        if (seen.has(key)) {
            problems.push(
                `${e.where} ("${e.file}") and ${seen.get(key).where} ("${seen.get(key).file}") are `
                + `the same asset once GitHub normalises them ("${key}") — one would overwrite `
                + `the other, or the second upload would be refused.`);
        }
        seen.set(key, e);
    }
}

// 4. The two places that match these names by hand still cover them. Neither
//    reads the config, so a rename here has to be a rename there.
if (existsSync(MIRROR)) {
    const src = readFileSync(MIRROR, 'utf8');
    for (const glob of ['*Setup*.exe', '*arm64.dmg']) {
        if (!src.includes(glob)) {
            problems.push(
                `.github/workflows/mirror-release.yml no longer globs ${glob} — the mirror `
                + `publishes what it finds, so a pattern that matches nothing is a silent no-op.`);
        }
    }
}
if (existsSync(RELEASE)) {
    const src = readFileSync(RELEASE, 'utf8');
    for (const want of ['Estella-Editor-Setup-', 'Estella-Editor-']) {
        if (!src.includes(want)) {
            problems.push(
                `.github/workflows/release-desktop.yml's completeness check no longer names `
                + `${want}* — it would pass a release missing that installer.`);
        }
    }
}

if (problems.length) {
    console.error('check-release-artifact-names: the published names disagree with themselves.\n');
    for (const p of problems) console.error(`  ✗ ${p}\n`);
    process.exit(1);
}

console.log(`check-release-artifact-names: ${declared.length} published desktop artifact(s) named `
    + `explicitly, whitespace-free, and distinct after the store's normalisation.`);
