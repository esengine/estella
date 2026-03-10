#!/usr/bin/env node

/**
 * Packages a pre-activated emsdk into a distributable archive for the editor's
 * "Auto Install" feature. Run this on each target platform (or in CI) to
 * produce per-platform archives that are uploaded to GitHub Releases.
 *
 * Prerequisites:
 *   1. emsdk is cloned and activated:
 *        git clone https://github.com/emscripten-core/emsdk.git
 *        cd emsdk && ./emsdk install 5.0.0 && ./emsdk activate 5.0.0
 *   2. Node.js >= 18
 *
 * Usage:
 *   node package-emsdk.js <emsdk-path> [--output <dir>]
 *
 * Output:
 *   emsdk-<version>-<platform>.tar.gz   (macOS/Linux)
 *   emsdk-<version>-<platform>.zip      (Windows)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const EMSDK_VERSION = '5.0.0';

const KEEP_DIRS = [
    'upstream/emscripten',
    'upstream/bin',
    'upstream/lib',
    'python',
    'node',
];

const KEEP_ROOT_FILES = [
    '.emscripten',
    'emsdk',
    'emsdk.bat',
    'emsdk.ps1',
    'emsdk_env.sh',
    'emsdk_env.bat',
    'emsdk_env.ps1',
    'emsdk_env.fish',
    'emsdk_manifest.json',
];

function getPlatform() {
    const p = os.platform();
    if (p === 'darwin') return 'mac';
    if (p === 'win32') return 'win';
    return 'linux';
}

function parseArgs() {
    const args = process.argv.slice(2);
    let emsdkPath = null;
    let outputDir = '.';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--output' && args[i + 1]) {
            outputDir = args[++i];
        } else if (!args[i].startsWith('-')) {
            emsdkPath = args[i];
        }
    }

    if (!emsdkPath) {
        console.error('Usage: node package-emsdk.js <emsdk-path> [--output <dir>]');
        process.exit(1);
    }

    return { emsdkPath: path.resolve(emsdkPath), outputDir: path.resolve(outputDir) };
}

function log(msg) {
    console.log(`[package-emsdk] ${msg}`);
}

function main() {
    const { emsdkPath, outputDir } = parseArgs();

    if (!fs.existsSync(path.join(emsdkPath, 'upstream/emscripten'))) {
        console.error(`Invalid emsdk path: ${emsdkPath}`);
        process.exit(1);
    }

    const platform = getPlatform();
    const archiveName = `emsdk-${EMSDK_VERSION}-${platform}`;
    const isWindows = platform === 'win';

    fs.mkdirSync(outputDir, { recursive: true });

    if (isWindows) {
        const outFile = path.join(outputDir, `${archiveName}.zip`);
        log(`Creating ${outFile}...`);

        const includeArgs = KEEP_DIRS.map(d => `"${archiveName}/${d}/*"`).join(' ');
        const rootFileArgs = KEEP_ROOT_FILES
            .filter(f => fs.existsSync(path.join(emsdkPath, f)))
            .map(f => `"${archiveName}/${f}"`)
            .join(' ');

        // Create a temporary symlink/junction with the archive name
        const tmpLink = path.join(path.dirname(emsdkPath), archiveName);
        try {
            if (fs.existsSync(tmpLink)) fs.rmSync(tmpLink, { recursive: true });
            execSync(`mklink /J "${tmpLink}" "${emsdkPath}"`, { shell: 'cmd', stdio: 'pipe' });
        } catch {
            // Fallback: just use the directory name
            log('Warning: mklink failed, using xcopy fallback');
        }

        const cwd = path.dirname(emsdkPath);
        const srcDir = fs.existsSync(tmpLink) ? archiveName : path.basename(emsdkPath);

        execSync(
            `powershell -NoProfile -Command "Compress-Archive -Path '${srcDir}' -DestinationPath '${outFile}' -Force"`,
            { cwd, stdio: 'inherit' },
        );

        if (fs.existsSync(tmpLink) && tmpLink !== emsdkPath) {
            execSync(`rmdir "${tmpLink}"`, { shell: 'cmd', stdio: 'pipe' });
        }

        log(`Done: ${outFile}`);
    } else {
        const outFile = path.join(outputDir, `${archiveName}.tar.gz`);
        log(`Creating ${outFile}...`);

        const includePaths = [
            ...KEEP_DIRS.map(d => `${archiveName}/${d}`),
            ...KEEP_ROOT_FILES
                .filter(f => fs.existsSync(path.join(emsdkPath, f)))
                .map(f => `${archiveName}/${f}`),
        ];

        // Create a symlink so the archive has the right top-level dir name
        const tmpLink = path.join(path.dirname(emsdkPath), archiveName);
        let srcDir = archiveName;
        try {
            if (fs.existsSync(tmpLink)) fs.rmSync(tmpLink, { recursive: true, force: true });
            fs.symlinkSync(emsdkPath, tmpLink);
        } catch {
            srcDir = path.basename(emsdkPath);
        }

        const cwd = path.dirname(emsdkPath);
        execSync(
            `tar czf "${outFile}" ${includePaths.join(' ')}`,
            { cwd, stdio: 'inherit' },
        );

        if (fs.existsSync(tmpLink) && tmpLink !== emsdkPath) {
            fs.rmSync(tmpLink, { recursive: true, force: true });
        }

        const stat = fs.statSync(outFile);
        log(`Done: ${outFile} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    }
}

main();
