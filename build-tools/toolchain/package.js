#!/usr/bin/env node

/**
 * Copies engine C++ source and cmake into Tauri resources for editor bundling.
 *
 * Usage: node package.js
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { mkdir, rm, cp, readdir, stat, writeFile, chmod } from 'fs/promises';
import { execSync } from 'child_process';

const CMAKE_VERSION = '3.31.7';

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
    log(`Engine source: ${formatSize(size)}`);

    // Download and bundle cmake
    await downloadCmake();

    const totalSize = await dirSize(OUTPUT_DIR);
    log(`\nDone! Total toolchain: ${formatSize(totalSize)}`);
    log(`Output: ${OUTPUT_DIR}`);
}

function getCmakeDownloadInfo() {
    const platform = os.platform();
    const arch = os.arch();

    if (platform === 'darwin') {
        return {
            filename: `cmake-${CMAKE_VERSION}-macos-universal.tar.gz`,
            stripPrefix: `cmake-${CMAKE_VERSION}-macos-universal/CMake.app/Contents`,
            format: 'tar.gz',
        };
    } else if (platform === 'win32') {
        return {
            filename: `cmake-${CMAKE_VERSION}-windows-x86_64.zip`,
            stripPrefix: `cmake-${CMAKE_VERSION}-windows-x86_64`,
            format: 'zip',
        };
    } else {
        const linuxArch = arch === 'arm64' ? 'aarch64' : 'x86_64';
        return {
            filename: `cmake-${CMAKE_VERSION}-linux-${linuxArch}.tar.gz`,
            stripPrefix: `cmake-${CMAKE_VERSION}-linux-${linuxArch}`,
            format: 'tar.gz',
        };
    }
}

async function downloadCmake() {
    const cmakeDir = path.join(OUTPUT_DIR, 'cmake');
    const cmakeBin = path.join(cmakeDir, 'bin', os.platform() === 'win32' ? 'cmake.exe' : 'cmake');

    if (fs.existsSync(cmakeBin)) {
        log(`cmake already present at ${cmakeDir}`);
        return;
    }

    const info = getCmakeDownloadInfo();
    const url = `https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/${info.filename}`;

    log(`Downloading cmake ${CMAKE_VERSION}...`);
    log(`  URL: ${url}`);

    const tmpDir = path.join(os.tmpdir(), `cmake-download-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const archivePath = path.join(tmpDir, info.filename);

    try {
        execSync(`curl -L -o "${archivePath}" "${url}"`, { stdio: 'inherit' });

        log('Extracting cmake...');

        if (fs.existsSync(cmakeDir)) {
            await rm(cmakeDir, { recursive: true, force: true });
        }
        await mkdir(cmakeDir, { recursive: true });

        if (info.format === 'tar.gz') {
            execSync(`tar xzf "${archivePath}" -C "${tmpDir}"`, { stdio: 'inherit' });
        } else {
            execSync(`unzip -q "${archivePath}" -d "${tmpDir}"`, { stdio: 'inherit' });
        }

        const extractedRoot = path.join(tmpDir, info.stripPrefix);

        // Copy only bin/cmake and share/cmake-* (minimal set)
        await mkdir(path.join(cmakeDir, 'bin'), { recursive: true });

        const cmakeExeName = os.platform() === 'win32' ? 'cmake.exe' : 'cmake';
        await cp(
            path.join(extractedRoot, 'bin', cmakeExeName),
            path.join(cmakeDir, 'bin', cmakeExeName),
        );
        if (os.platform() !== 'win32') {
            await chmod(path.join(cmakeDir, 'bin', 'cmake'), 0o755);
        }

        // Find the share/cmake-* directory (e.g., share/cmake-3.31)
        const shareDir = path.join(extractedRoot, 'share');
        const shareEntries = await readdir(shareDir);
        const cmakeShareDir = shareEntries.find(e => e.startsWith('cmake-'));
        if (!cmakeShareDir) {
            throw new Error('cmake share directory not found in archive');
        }
        await cp(
            path.join(shareDir, cmakeShareDir),
            path.join(cmakeDir, 'share', cmakeShareDir),
            { recursive: true },
        );

        // Verify
        const testResult = execSync(`"${path.join(cmakeDir, 'bin', cmakeExeName)}" --version`, { encoding: 'utf8' });
        log(`  cmake installed: ${testResult.split('\n')[0]}`);

        const cmakeSize = await dirSize(cmakeDir);
        log(`  cmake size: ${formatSize(cmakeSize)}`);
    } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

main().catch(err => {
    console.error(`[toolchain] ERROR: ${err.message}`);
    process.exit(1);
});
