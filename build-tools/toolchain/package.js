#!/usr/bin/env node

/**
 * Packages engine source and cmake into Tauri resources for editor bundling.
 * All paths and versions are driven by toolchain.manifest.json.
 *
 * Usage: node package.js
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { mkdir, rm, cp, readdir, stat, chmod } from 'fs/promises';
import { execSync } from 'child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'desktop/src-tauri/toolchain');
const MANIFEST_PATH = path.join(ROOT_DIR, 'toolchain.manifest.json');

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

function loadManifest() {
    if (!fs.existsSync(MANIFEST_PATH)) {
        throw new Error(`Manifest not found: ${MANIFEST_PATH}`);
    }
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function resolveTemplate(str, vars) {
    return str.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

// =============================================================================
// Engine source packaging
// =============================================================================

async function packageEngineSource(manifest) {
    const engineSrcDir = path.join(OUTPUT_DIR, 'engine-src');
    if (fs.existsSync(engineSrcDir)) {
        await rm(engineSrcDir, { recursive: true, force: true });
    }
    await mkdir(engineSrcDir, { recursive: true });

    const { engine, third_party } = manifest;

    // Root files (CMakeLists.txt etc.)
    for (const file of engine.root_files) {
        await cp(path.join(ROOT_DIR, file), path.join(engineSrcDir, file));
    }

    // Full directories
    for (const dir of engine.directories) {
        const src = path.join(ROOT_DIR, dir);
        const dest = path.join(engineSrcDir, dir);
        if (fs.existsSync(src)) {
            await mkdir(path.dirname(dest), { recursive: true });
            await cp(src, dest, { recursive: true });
            log(`  copied: ${dir}/`);
        }
    }

    // Third-party
    const tpDest = path.join(engineSrcDir, 'third_party');
    await mkdir(tpDest, { recursive: true });

    for (const file of third_party.root_files) {
        const src = path.join(ROOT_DIR, 'third_party', file);
        if (fs.existsSync(src)) {
            await cp(src, path.join(tpDest, file));
        }
    }

    // Full third-party copies
    for (const dir of third_party.full) {
        const src = path.join(ROOT_DIR, 'third_party', dir);
        if (fs.existsSync(src)) {
            await cp(src, path.join(tpDest, dir), { recursive: true });
            log(`  copied: third_party/${dir}`);
        }
    }

    // Partial third-party copies (only specified subdirs)
    for (const [lib, subdirs] of Object.entries(third_party.partial)) {
        const libSrc = path.join(ROOT_DIR, 'third_party', lib);
        if (!fs.existsSync(libSrc)) continue;

        for (const subdir of subdirs) {
            const src = path.join(libSrc, subdir);
            const dest = path.join(tpDest, lib, subdir);
            if (fs.existsSync(src)) {
                await mkdir(path.dirname(dest), { recursive: true });
                await cp(src, dest, { recursive: true });
            }
        }
        log(`  copied: third_party/${lib} (partial: ${subdirs.length} dirs)`);
    }

    const size = await dirSize(engineSrcDir);
    log(`Engine source: ${formatSize(size)}`);
}

// =============================================================================
// CMake packaging
// =============================================================================

function getCmakePlatformKey() {
    const platform = os.platform();
    if (platform === 'darwin') return 'darwin';
    if (platform === 'win32') return 'win32';
    const arch = os.arch();
    return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

async function packageCmake(manifest) {
    const cmakeDir = path.join(OUTPUT_DIR, 'cmake');
    const cmakeExeName = os.platform() === 'win32' ? 'cmake.exe' : 'cmake';
    const cmakeBin = path.join(cmakeDir, 'bin', cmakeExeName);

    if (fs.existsSync(cmakeBin)) {
        log(`cmake already present at ${cmakeDir}`);
        return;
    }

    const { version, platforms } = manifest.cmake;
    const platformKey = getCmakePlatformKey();
    const platformInfo = platforms[platformKey];
    if (!platformInfo) {
        throw new Error(`No cmake config for platform: ${platformKey}`);
    }

    const vars = { version };
    const filename = resolveTemplate(platformInfo.filename, vars);
    const stripPrefix = resolveTemplate(platformInfo.strip_prefix, vars);
    const url = `https://github.com/Kitware/CMake/releases/download/v${version}/${filename}`;

    log(`Downloading cmake ${version}...`);
    log(`  URL: ${url}`);

    const tmpDir = path.join(os.tmpdir(), `cmake-download-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const archivePath = path.join(tmpDir, filename);

    try {
        execSync(`curl -sL -o "${archivePath}" "${url}"`, { stdio: 'inherit' });

        log('Extracting cmake...');

        if (fs.existsSync(cmakeDir)) {
            await rm(cmakeDir, { recursive: true, force: true });
        }
        await mkdir(path.join(cmakeDir, 'bin'), { recursive: true });

        const isZip = filename.endsWith('.zip');
        if (isZip) {
            execSync(`unzip -q "${archivePath}" -d "${tmpDir}"`, { stdio: 'inherit' });
        } else {
            execSync(`tar xzf "${archivePath}" -C "${tmpDir}"`, { stdio: 'inherit' });
        }

        const extractedRoot = path.join(tmpDir, stripPrefix);

        // Copy cmake binary
        await cp(
            path.join(extractedRoot, 'bin', cmakeExeName),
            path.join(cmakeDir, 'bin', cmakeExeName),
        );
        if (os.platform() !== 'win32') {
            await chmod(path.join(cmakeDir, 'bin', 'cmake'), 0o755);
        }

        // Copy share/cmake-* directory
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
        const testResult = execSync(`"${cmakeBin}" --version`, { encoding: 'utf8' });
        log(`  cmake installed: ${testResult.split('\n')[0]}`);

        const cmakeSize = await dirSize(cmakeDir);
        log(`  cmake size: ${formatSize(cmakeSize)}`);
    } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
    log('Packaging toolchain for editor bundling');
    const manifest = loadManifest();

    await packageEngineSource(manifest);
    await packageCmake(manifest);

    const totalSize = await dirSize(OUTPUT_DIR);
    log(`\nDone! Total toolchain: ${formatSize(totalSize)}`);
    log(`Output: ${OUTPUT_DIR}`);
}

main().catch(err => {
    console.error(`[toolchain] ERROR: ${err.message}`);
    process.exit(1);
});
