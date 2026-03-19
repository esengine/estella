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
const NINJA_VERSION = '1.13.2';

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

function ninjaDownloadUrl() {
    const p = os.platform();
    const arch = os.arch();
    if (p === 'darwin') return `https://github.com/ninja-build/ninja/releases/download/v${NINJA_VERSION}/ninja-mac.zip`;
    if (p === 'win32') {
        const asset = arch === 'arm64' ? 'ninja-winarm64' : 'ninja-win';
        return `https://github.com/ninja-build/ninja/releases/download/v${NINJA_VERSION}/${asset}.zip`;
    }
    const asset = arch === 'arm64' ? 'ninja-linux-aarch64' : 'ninja-linux';
    return `https://github.com/ninja-build/ninja/releases/download/v${NINJA_VERSION}/${asset}.zip`;
}

function ensureNinja(emsdkPath) {
    const binDir = path.join(emsdkPath, 'upstream', 'bin');
    const ninjaName = os.platform() === 'win32' ? 'ninja.exe' : 'ninja';
    const ninjaPath = path.join(binDir, ninjaName);

    if (fs.existsSync(ninjaPath)) {
        log(`ninja already present at ${ninjaPath}`);
        return;
    }

    const url = ninjaDownloadUrl();
    log(`Downloading ninja ${NINJA_VERSION} from ${url}...`);

    const tmpZip = path.join(os.tmpdir(), `ninja-${NINJA_VERSION}.zip`);
    execSync(`curl -L -o "${tmpZip}" "${url}"`, { stdio: 'inherit' });

    fs.mkdirSync(binDir, { recursive: true });

    // Extract ninja binary from zip
    if (os.platform() === 'win32') {
        execSync(
            `powershell -NoProfile -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${binDir}' -Force"`,
            { stdio: 'inherit' },
        );
    } else {
        execSync(`unzip -o "${tmpZip}" ${ninjaName} -d "${binDir}"`, { stdio: 'inherit' });
        fs.chmodSync(ninjaPath, 0o755);
    }

    fs.rmSync(tmpZip, { force: true });
    log(`ninja installed to ${ninjaPath}`);
}

function patchShellForSingleFile(emsdkPath) {
    const shellPath = path.join(emsdkPath, 'upstream/emscripten/src/shell.js');
    if (!fs.existsSync(shellPath)) {
        log('Warning: shell.js not found, skipping patch');
        return;
    }

    let content = fs.readFileSync(shellPath, 'utf8');
    const marker = '// [ESEngine patched]';
    if (content.includes(marker)) {
        log('shell.js already patched');
        return;
    }

    // In SINGLE_FILE mode all resources are inlined, scriptDirectory is unused.
    // The original `new URL('.', _scriptName)` triggers a Chrome security
    // warning under file:// protocol. Guard it with a SINGLE_FILE check.
    const original = "scriptDirectory = new URL('.', _scriptName).href; // includes trailing slash";
    const patched = [
        marker,
        '#if !SINGLE_FILE',
        "    scriptDirectory = new URL('.', _scriptName).href; // includes trailing slash",
        '#endif',
    ].join('\n');

    if (!content.includes(original)) {
        log('Warning: scriptDirectory pattern not found in shell.js, skipping patch');
        return;
    }

    content = content.replace(original, patched);
    fs.writeFileSync(shellPath, content, 'utf8');
    log('Patched shell.js: skip scriptDirectory detection in SINGLE_FILE mode');
}

function main() {
    const { emsdkPath, outputDir } = parseArgs();

    if (!fs.existsSync(path.join(emsdkPath, 'upstream/emscripten'))) {
        console.error(`Invalid emsdk path: ${emsdkPath}`);
        process.exit(1);
    }

    ensureNinja(emsdkPath);
    patchShellForSingleFile(emsdkPath);

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
