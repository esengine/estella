// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'path';
import { mkdir, cp, readdir, stat, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import config from '../build.config.js';
import * as logger from '../utils/logger.js';

export async function syncToDesktop(options = {}) {
    const { wasm = true, sdk = true } = options;

    logger.step('Syncing to desktop/public...');

    const rootDir = config.paths.root;
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

// Write wasm.manifest.json into each wasm dest dir: the ABI hash the binary was
// built against, the build variant(s) present, and git/time provenance. The
// abiHash is read from the freshly-built SDK metadata — the wasm and that
// constant are generated together by the EHT pipeline, so it faithfully mirrors
// the binary's getAbiLayoutHash(). Defensive: a failure here only warns.
async function writeWasmManifest(rootDir) {
    try {
        const variants = [...new Set(Object.keys(config.sync.wasm).map((src) => path.basename(src)))].filter(
            (v) => existsSync(path.join(rootDir, 'build/wasm', v)),
        );

        const genPath = path.join(config.paths.sdk, 'src/component.generated.ts');
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
            schema: 1,
            abiHash,
            editorTarget: 'web',
            variants,
            gitSha,
            builtAt: new Date().toISOString(),
        };

        const dests = [...new Set(Object.values(config.sync.wasm))];
        for (const dest of dests) {
            const destDir = path.join(rootDir, dest);
            if (!existsSync(destDir)) continue;
            await writeFile(
                path.join(destDir, 'wasm.manifest.json'),
                JSON.stringify(manifest, null, 2) + '\n',
            );
        }
        logger.debug(`Stamped wasm.manifest.json (abi=${abiHash} git=${gitSha} variants=${variants.join(',') || 'none'})`);
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
