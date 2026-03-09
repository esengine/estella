#!/usr/bin/env node

/**
 * Copies engine C++ source into Tauri resources for editor bundling.
 *
 * Usage: node package.js
 */

import fs from 'fs';
import path from 'path';
import { mkdir, rm, cp, readdir, stat, writeFile } from 'fs/promises';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'desktop/src-tauri/toolchain');

function log(msg) {
    console.log(`[toolchain] ${msg}`);
}

async function dirSize(dirPath) {
    let total = 0;
    const entries = await readdir(dirPath, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
        if (entry.isFile()) {
            const fullPath = path.join(entry.parentPath || entry.path, entry.name);
            const s = await stat(fullPath).catch(() => null);
            if (s) total += s.size;
        }
    }
    return total;
}

function formatSize(bytes) {
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main() {
    log('Packaging engine source for editor bundling');

    const engineSrcDir = path.join(OUTPUT_DIR, 'engine-src');
    if (fs.existsSync(engineSrcDir)) {
        await rm(engineSrcDir, { recursive: true, force: true });
    }
    await mkdir(engineSrcDir, { recursive: true });

    // CMakeLists.txt
    await cp(path.join(ROOT_DIR, 'CMakeLists.txt'), path.join(engineSrcDir, 'CMakeLists.txt'));

    // cmake/ modules
    await cp(path.join(ROOT_DIR, 'cmake'), path.join(engineSrcDir, 'cmake'), { recursive: true });
    log('  copied: cmake/');

    // tools/ (EHT code generator)
    await cp(path.join(ROOT_DIR, 'tools'), path.join(engineSrcDir, 'tools'), { recursive: true });
    log('  copied: tools/');

    // src/esengine/
    await mkdir(path.join(engineSrcDir, 'src'), { recursive: true });
    await cp(path.join(ROOT_DIR, 'src/esengine'), path.join(engineSrcDir, 'src/esengine'), { recursive: true });
    log('  copied: src/esengine/');

    // third_party/
    await mkdir(path.join(engineSrcDir, 'third_party'), { recursive: true });
    const thirdPartyCmake = path.join(ROOT_DIR, 'third_party', 'CMakeLists.txt');
    if (fs.existsSync(thirdPartyCmake)) {
        await cp(thirdPartyCmake, path.join(engineSrcDir, 'third_party', 'CMakeLists.txt'));
    }
    const thirdPartyDirs = [
        'glm', 'cute_tiled', 'stb',
        'spine-runtimes-3.8', 'spine-runtimes-4.1', 'spine-runtimes-4.2',
        'nlohmann',
    ];
    for (const dir of thirdPartyDirs) {
        const srcDir = path.join(ROOT_DIR, 'third_party', dir);
        if (fs.existsSync(srcDir)) {
            await cp(srcDir, path.join(engineSrcDir, 'third_party', dir), { recursive: true });
            log(`  copied: third_party/${dir}`);
        }
    }

    const size = await dirSize(engineSrcDir);
    log(`\nDone! Engine source: ${formatSize(size)}`);
    log(`Output: ${engineSrcDir}`);
}

main().catch(err => {
    console.error(`[toolchain] ERROR: ${err.message}`);
    process.exit(1);
});
