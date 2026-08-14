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
//     --template <dir>    android/ios: the runtime template to wrap, else the installed one
//     --json <file>       also write the result here, for a caller that reads it back
//     --enforce-budget    fail (exit 1) when the package is over a size limit
//     --steam-sdk <dir>   desktop: a Steamworks SDK whose redistributable ships in the app
//     --steam-appid <id>  desktop: also write the Steam depot scripts for this app id
//
// Prints the export result as JSON — errors, warnings, and what the package weighs
// against the limits in force — so a caller can tell a clean package from one that
// silently dropped half a scene, or from one that will be refused for being too big.
//
// The size report rides the result rather than being a second file: one artifact a
// CI job reads, `result.size`, with the same verdicts the build dialog draws.
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installedTemplateDir, iosTemplateSources } from '../../build-tools/utils/nativeTemplate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.join(HERE, '..');
const REPO = path.join(DESKTOP, '..');

function parseArgs(argv) {
    const [projectDir, ...rest] = argv;
    if (!projectDir) {
        console.error('usage: node desktop/scripts/export-project.mjs <projectDir> '
            + '[--platform android] [--out dir] [--output package|project] [--template dir] '
            + '[--enforce-budget]');
        process.exit(2);
    }
    const opts = { projectDir: path.resolve(projectDir), platform: 'android' };
    // Options take a value; these do not. Without the distinction a trailing
    // `--enforce-budget` swallows nothing and ends the loop, so a CI job would
    // pass the flag and silently get no gate.
    const FLAGS = new Set(['enforce-budget']);
    for (let i = 0; i < rest.length;) {
        const key = rest[i]?.replace(/^--/, '');
        if (!key) break;
        if (FLAGS.has(key)) {
            opts[key] = true;
            i += 1;
            continue;
        }
        const value = rest[i + 1];
        if (value === undefined) break;
        opts[key] = value;
        i += 2;
    }
    return opts;
}

/** Which desktop template this machine can also RUN, for --template. */
const HOST_DESKTOP_OS = process.platform === 'darwin' ? 'macos'
    : process.platform === 'win32' ? 'windows' : 'linux';

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
        // The Basis encoder finds its own .cjs/.wasm through `import.meta.url`,
        // so inlining it makes it look beside the BUNDLE. External keeps the
        // specifier, and the temp dir is as deep under desktop/ as electron/ is.
        external: ['esbuild', 'electron', 'sharp', '../../build-tools/basis/encoder.mjs'],
        logLevel: 'error',
        banner: {
            js: "import { createRequire as __esCreateRequire } from 'node:module';\n"
                + `const require = __esCreateRequire('${fileUrl(path.join(DESKTOP, 'package.json'))}');\n`,
        },
    });
    const mod = await import(fileUrl(outfile));
    return { exportGame: mod.exportGame, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * The editor's own project-format helpers, bundled the same way.
 *
 * Reading the manifest by hand here is how this script drifts from the editor,
 * which is the one thing it exists not to do: orientation was read as a
 * top-level `orientation` field, a key the format does not have, so every
 * project packaged landscape — a 600x1080 shmup included.
 */
async function loadProjectFormat() {
    const require = createRequire(path.join(DESKTOP, 'package.json'));
    const esbuild = require('esbuild');
    const dir = mkdtempSync(path.join(DESKTOP, '.format-'));
    const outfile = path.join(dir, 'format.mjs');
    await esbuild.build({
        // runtimeConfig re-exports nothing of format's, so both entries are bundled
        // into one module: a headless export that derived the project's settings by
        // hand would be a second answer to what a project MEANS.
        stdin: {
            contents: "export * from '../pipeline/src/project/format';\nexport * from '../pipeline/src/project/runtimeConfig';\n",
            resolveDir: DESKTOP,
            sourcefile: 'projectFormat.ts',
            loader: 'ts',
        },
        outfile, bundle: true, format: 'esm', platform: 'node', target: 'node20',
        external: ['esbuild', 'electron', 'sharp'], logLevel: 'error',
    });
    const mod = await import(fileUrl(outfile));
    rmSync(dir, { recursive: true, force: true });
    return mod;
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
const nativePlatform = platform === 'android' || platform === 'ios';
const templateDir = nativePlatform
    ? (opts.template
        ? path.resolve(opts.template)
        : firstExisting([installedTemplateDir(engineVersion, platform)]) ?? null)
    : null;
// Desktop takes a template PER OS, and assembles one app for each it finds: the
// assembler is pure Node, so a headless run on one machine produces the same set
// the editor would. --template names one and then it is the only one.
const desktopTemplates = platform !== 'desktop' ? [] : (opts.template
    ? [{ os: HOST_DESKTOP_OS, dir: path.resolve(opts.template) }]
    : ['windows', 'macos', 'linux'].flatMap((os) => {
        const dir = firstExisting([installedTemplateDir(engineVersion, os)]);
        return dir ? [{ os, dir }] : [];
    }));
// The engine runtime for this target — the headless half of the editor's
// `platformRuntimeDirs`. WeChat's is a different build (WXWebAssembly glue, `-t
// wechat`), and handing it the web one produced either a "runtime not found"
// failure or a package that could not boot on a device.
const wasmDir = platform === 'wechat'
    ? firstExisting([
        path.join(DESKTOP, 'public', 'wasm-wechat'),
        path.join(REPO, 'build', 'wasm', 'wechat'),
    ]) ?? path.join(DESKTOP, 'public', 'wasm')
    : path.join(DESKTOP, 'public', 'wasm');

const { resolveOrientation, parseManifest, runtimeConfigOf, cookOptionsOf } = await loadProjectFormat();
// PARSED, not read by hand: the parser normalizes legacy platform ids and drops
// values that could not be judged against, and a budget read straight off the JSON
// here would be the orientation bug again with a different field.
const manifest = parseManifest(project);
const sizeBudgetBytes = manifest.packaging?.sizeBudget?.[platform];
const { exportGame, cleanup } = await loadExportGame();
let code = 1;
try {
    const result = await exportGame({
        root: opts.projectDir,
        entryScene,
        scriptsEntry,
        gameHostEntry: path.join(DESKTOP, 'src', 'gameHost.ts'),
        sdkDistDir: path.join(REPO, 'sdk', 'dist'),
        wasmDir,
        outDir,
        platform,
        title: opts.title ?? project.name ?? path.basename(opts.projectDir),
        orientation: resolveOrientation(project),
        // The project's OWN settings, through the editor's own derivation: without
        // it a headless package ships every setting at its default while claiming
        // to be the package the dialog makes.
        runtime: runtimeConfigOf(manifest),
        // Same bargain, one field over: the cook flags are ALSO the project's
        // own, and passing none of them shipped every automated package raw.
        ...cookOptionsOf(manifest),
        androidTemplate: platform === 'android' ? templateDir : null,
        desktopTemplates,
        desktopChannel: opts['steam-appid'] ? 'steam' : undefined,
        steam: (opts['steam-appid'] || opts['steam-sdk'])
            ? { appId: Number(opts['steam-appid']) || undefined, sdkPath: opts['steam-sdk'] }
            : undefined,
        iosSources: platform === 'ios' && templateDir ? iosTemplateSources(templateDir) : null,
        androidOutput: opts.output === 'project' ? 'project' : undefined,
        sizeBudgetBytes,
    });
    const report = { ...result, outDir };
    console.log(JSON.stringify(report, null, 2));
    // stdout carries the cook's own progress too, so a caller that wants the
    // result mechanically cannot just redirect it.
    if (opts.json) writeFileSync(path.resolve(opts.json), `${JSON.stringify(report, null, 2)}\n`);
    code = result.ok ? 0 : 1;

    // The gate is opt-in. A package over its limit is still a package — it built,
    // it runs, and whether that is a release-blocking fact belongs to the caller,
    // not to the exporter. Said in prose on stderr as well as in the exit code,
    // because a CI log that only goes red tells nobody which limit or by how much.
    const over = (result.size?.verdicts ?? []).filter((v) => v.status === 'over');
    for (const v of over) {
        const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
        console.error(`size budget: ${v.budget.scope} is ${mb(v.measuredBytes)}, over the `
            + `${mb(v.budget.maxBytes)} limit (${v.budget.note}).`);
    }
    if (over.length > 0 && opts['enforce-budget']) code = 1;
} finally {
    // Before the exit, not after: process.exit() in the try block would skip this
    // and leave the bundle dir behind.
    cleanup();
}
process.exit(code);
