// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'path';
import { mkdir, cp, readdir, rm, stat, readFile, writeFile } from 'fs/promises';
import { existsSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';

export async function syncToDesktop(options = {}) {
    const { wasm = true, sdk = true } = options;

    const rootDir = config.paths.root;

    // The editor is an optional submodule. Creating desktop/public under an
    // uninitialised one would leave build output where a checkout is supposed to
    // go, so an absent editor is a skip, not a directory.
    if (!existsSync(path.join(rootDir, 'desktop'))) {
        logger.info('Sync: no editor checkout — skipping (engine output stays in build/)');
        return { synced: 0, skipped: true };
    }

    logger.step('Syncing to desktop/public...');

    let synced = 0;

    if (wasm) {
        for (const [src, dest] of Object.entries(config.sync.wasm)) {
            const srcPath = path.join(rootDir, src);
            const destPath = path.join(rootDir, dest);

            if (existsSync(srcPath)) {
                synced += await copyFiles(srcPath, destPath, ['.js', '.wasm']);
            }
        }
        // Stamp a build manifest beside the wasm so the editor can detect
        // variant / ABI drift and show build provenance (see desktop EngineGuard).
        await writeWasmManifest(rootDir);
    }

    if (sdk) {
        for (const [src, dest] of Object.entries(config.sync.sdk)) {
            const srcPath = path.join(rootDir, src);
            const destPath = path.join(rootDir, dest);

            if (existsSync(srcPath)) {
                // Mirror rather than merge: the shared chunk filenames are the
                // bundler's to choose, so a merge leaves the previous build's
                // chunks behind forever and ships them to the editor.
                await rm(destPath, { recursive: true, force: true });
                synced += await copyDirectory(srcPath, destPath);
            }
        }
    }

    if (synced > 0) {
        logger.success(`Sync: ${synced} files copied to desktop/public`);
    } else {
        logger.info('Sync: No files to sync');
    }

    return { synced };
}

/** The newest artifact in a directory, in epoch ms — 0 for an empty/absent one.
 *  Flat by design: a wasm output dir has no subdirectories. */
function newestArtifact(dir) {
    if (!existsSync(dir)) return 0;
    let newest = 0;
    for (const name of readdirSync(dir)) {
        if (name === 'wasm.manifest.json') continue; // an output of this function
        try {
            const at = statSync(path.join(dir, name)).mtimeMs;
            if (at > newest) newest = at;
        } catch { /* raced with a rebuild — the other files still answer */ }
    }
    return newest;
}

// Write wasm.manifest.json into each wasm dir: ABI hash, per-variant build time,
// git provenance. A variant is dated from ITS OWN newest artifact — they are
// separate builds, so one `-t web` restamp would vouch for any age of wechat.
async function writeWasmManifest(rootDir) {
    try {
        const variants = {};
        for (const src of new Set(Object.keys(config.sync.wasm))) {
            const at = newestArtifact(path.join(rootDir, src));
            if (at > 0) variants[path.basename(src)] = { builtAt: new Date(at).toISOString() };
        }

        const genPath = path.join(config.paths.sdk, 'src/ecs/component.generated.ts');
        const gen = await readFile(genPath, 'utf8');
        const m = /ABI_LAYOUT_HASH\s*=\s*['"]([0-9a-f]+)['"]/i.exec(gen);
        const abiHash = m ? m[1] : 'unknown';

        let gitSha = 'unknown';
        try {
            gitSha = execSync('git rev-parse --short HEAD', { cwd: rootDir }).toString().trim();
        } catch {
            // not a git checkout — leave 'unknown'
        }

        const manifest = {
            schema: 2,
            abiHash,
            editorTarget: 'web',
            variants,
            gitSha,
            stampedAt: new Date().toISOString(),
        };

        // Both the build dirs and the synced ones: whoever asks how old a binary
        // is asks the directory they are about to package FROM, and only half of
        // those are the editor's.
        const dirs = [...new Set([...Object.keys(config.sync.wasm), ...Object.values(config.sync.wasm)])];
        for (const dir of dirs) {
            const abs = path.join(rootDir, dir);
            if (!existsSync(abs)) continue;
            await writeFile(
                path.join(abs, 'wasm.manifest.json'),
                JSON.stringify(manifest, null, 2) + '\n',
            );
        }
        const ages = Object.entries(variants).map(([v, s]) => `${v}@${s.builtAt}`).join(' ');
        logger.debug(`Stamped wasm.manifest.json (abi=${abiHash} git=${gitSha} ${ages || 'no variants'})`);
    } catch (err) {
        logger.warn(`Could not stamp wasm.manifest.json: ${err.message}`);
    }
}

async function copyFiles(srcDir, destDir, extensions) {
    if (!existsSync(srcDir)) {
        return 0;
    }

    await mkdir(destDir, { recursive: true });

    let count = 0;
    const entries = await readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (extensions && !extensions.some(ext => entry.name.endsWith(ext))) continue;

        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        await cp(srcPath, destPath);
        logger.debug(`Synced ${entry.name}`);
        count++;
    }

    return count;
}

async function copyDirectory(srcDir, destDir) {
    if (!existsSync(srcDir)) {
        return 0;
    }

    await mkdir(destDir, { recursive: true });

    let count = 0;
    const entries = await readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        if (entry.isDirectory()) {
            count += await copyDirectory(srcPath, destPath);
        } else if (entry.isFile()) {
            await cp(srcPath, destPath);
            logger.debug(`Synced ${entry.name}`);
            count++;
        }
    }

    return count;
}

export async function syncWasmOnly() {
    return syncToDesktop({ wasm: true, sdk: false });
}

export async function syncSdkOnly() {
    return syncToDesktop({ wasm: false, sdk: true });
}
