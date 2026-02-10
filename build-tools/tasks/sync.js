import path from 'path';
import { mkdir, cp, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
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
