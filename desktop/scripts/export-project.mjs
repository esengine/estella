// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Package a project the way the editor's "Package Project" does, without the
// editor: `exportGame` is plain node + esbuild (no electron), so a headless run is
// just a matter of bundling the TypeScript and calling it.
//
// This exists because the native app's content comes from an export, and verifying
// a platform means packaging real projects for it repeatedly — one example after
// another. Doing that through the editor UI is not repeatable, and a second export
// path written by hand would drift from the one every game takes.
//
//   node desktop/scripts/export-project.mjs <projectDir> [options]
//     --platform <id>     web | desktop | wechat | playable | android | ios (default android)
//     --out <dir>         output dir (default <projectDir>/dist-<platform>)
//     --scene <path>      entry scene, project-relative (default: the project's own)
//     --title <name>      app title (default: the project's name)
//     --scripts <path>    scripts entry, project-relative (default src/main.ts if present)
//
// Prints the export result as JSON — errors and warnings included, so a caller can
// tell a clean package from one that silently dropped half a scene.
import path from 'node:path';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installedTemplateDir } from '../../build-tools/utils/nativeTemplate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.join(HERE, '..');
const REPO = path.join(DESKTOP, '..');

function parseArgs(argv) {
    const [projectDir, ...rest] = argv;
    if (!projectDir) {
        console.error('usage: node desktop/scripts/export-project.mjs <projectDir> '
            + '[--platform android] [--out dir] [--output package|project] [--template dir]');
        process.exit(2);
    }
    const opts = { projectDir: path.resolve(projectDir), platform: 'android' };
    for (let i = 0; i < rest.length; i += 2) {
        const key = rest[i]?.replace(/^--/, '');
        const value = rest[i + 1];
        if (!key || value === undefined) break;
        opts[key] = value;
    }
    return opts;
}

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;

// Bundle exportGame.ts to a temp module and import it. ESM, because the cook reads
// `import.meta.url` (the basis encoder locates its binary that way) — and with a
// `require` shim bound to desktop/, because some of its dependencies are CommonJS
// (pngjs). esbuild itself stays external: the module resolves it at runtime the
// same way the electron main process does.
async function loadExportGame() {
    const require = createRequire(path.join(DESKTOP, 'package.json'));
    const esbuild = require('esbuild');
    // Inside desktop/, so the bundle's own `import 'esbuild'` resolves through
    // desktop/node_modules the way it does for the electron main process.
    const dir = mkdtempSync(path.join(DESKTOP, '.export-'));
    const outfile = path.join(dir, 'exportGame.mjs');
    await esbuild.build({
        entryPoints: [path.join(DESKTOP, 'electron', 'exportGame.ts')],
        outfile, bundle: true, format: 'esm', platform: 'node', target: 'node20',
        external: ['esbuild', 'electron', 'sharp'], logLevel: 'error',
        banner: {
            js: "import { createRequire as __esCreateRequire } from 'node:module';\n"
                + `const require = __esCreateRequire('${fileUrl(path.join(DESKTOP, 'package.json'))}');\n`,
        },
    });
    const mod = await import(fileUrl(outfile));
    return { exportGame: mod.exportGame, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The project's own settings, so a headless export matches what the editor would do. */
function projectSettings(projectDir) {
    for (const name of ['project.esproject', 'project.esproj', 'project.json']) {
        const file = path.join(projectDir, name);
        if (existsSync(file)) {
            try {
                return JSON.parse(readFileSync(file, 'utf8'));
            } catch {
                return {};
            }
        }
    }
    return {};
}

function firstExisting(candidates) {
    return candidates.find((c) => existsSync(c));
}

const opts = parseArgs(process.argv.slice(2));
const project = projectSettings(opts.projectDir);
const platform = opts.platform;

const entryScene = opts.scene ?? project.defaultScene ?? (
    firstExisting([
        path.join(opts.projectDir, 'assets', 'scenes', 'main.esscene'),
        path.join(opts.projectDir, 'scenes', 'main.esscene'),
    ])?.slice(opts.projectDir.length + 1).replace(/\\/g, '/')
);
if (!entryScene) {
    console.error(`No entry scene found in ${opts.projectDir} (pass --scene <project-relative path>).`);
    process.exit(2);
}

const scriptsEntry = opts.scripts ?? (existsSync(path.join(opts.projectDir, 'src', 'main.ts'))
    ? 'src/main.ts' : undefined);

const outDir = path.resolve(opts.out ?? path.join(opts.projectDir, `dist-${platform}`));

// The native half the editor resolves through the installed-template store. Named
// explicitly with --template, else looked up the way the editor does, so a headless
// export assembles the same package the dialog would rather than content alone.
const engineVersion = JSON.parse(readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')).version;
const androidTemplate = platform === 'android'
    ? (opts.template
        ? path.resolve(opts.template)
        : firstExisting([installedTemplateDir(engineVersion, 'android')]) ?? null)
    : null;
const { exportGame, cleanup } = await loadExportGame();
let code = 1;
try {
    const result = await exportGame({
        root: opts.projectDir,
        entryScene,
        scriptsEntry,
        gameHostEntry: path.join(DESKTOP, 'src', 'gameHost.ts'),
        sdkDistDir: path.join(REPO, 'sdk', 'dist'),
        wasmDir: path.join(DESKTOP, 'public', 'wasm'),
        outDir,
        platform,
        title: opts.title ?? project.name ?? path.basename(opts.projectDir),
        orientation: project.orientation ?? 'landscape',
        androidTemplate,
        androidOutput: opts.output === 'project' ? 'project' : undefined,
    });
    console.log(JSON.stringify({ ...result, outDir }, null, 2));
    code = result.ok ? 0 : 1;
} finally {
    // Before the exit, not after: process.exit() in the try block would skip this
    // and leave the bundle dir behind.
    cleanup();
}
process.exit(code);
