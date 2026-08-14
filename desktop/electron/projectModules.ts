// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Optional native modules a PROJECT supplies — the third-party half of
 *        `sdk/src/sideModules/registry.ts`.
 *
 *        The engine ships a handful of these (physics, basis, the spine
 *        runtimes) and they get real treatment everywhere: acquired through one
 *        host, staged into the package, required by name on a mini-game, inlined
 *        as base64 in a playable. A third-party runtime — a vector-animation
 *        player, another solver — had none of that. It could be fetched by hand
 *        on the web, which is exactly the platform where doing it by hand is
 *        easiest and least necessary; on a mini-game there is no `fetch` and the
 *        binary has to be IN the package, and a playable has no files at all.
 *
 *        So a project declares its modules the way it declares its own export
 *        platforms (`.esengine/platforms/<id>.mjs`), and from there they are
 *        ordinary side modules:
 *
 *          .esengine/modules/<id>/
 *            module.json          { "file": "rive", "globalName": "RiveModule" }
 *            web/rive.js  rive.wasm      ← web, desktop, playable
 *            wechat/rive.js  rive.wasm   ← every mini-game vendor
 *
 *        Per-platform directories rather than one build, because that is the
 *        actual shape of the problem: a mini-game needs its own emscripten build
 *        (WXWebAssembly glue, a different es-target), which is why the engine's
 *        own modules are built twice too. A module with no build for the target
 *        being exported is a WARNING, not a failure — the package is otherwise
 *        correct and the game can degrade, the same way it degrades when a
 *        capability is absent.
 *
 *        Pure Node (fs). Read by the exporters; the ids they stage are written
 *        into game.config.json, which is how the runtime learns them.
 */
import { readFile, readdir, cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isNativePlatform, type ExportPlatform } from '../../pipeline/src/project/platforms';

/** Where a project keeps them. */
export const PROJECT_MODULES_DIR = path.join('.esengine', 'modules');

/** A project module, as declared and located. */
export interface ProjectModule {
    /** Directory name = the `SideModuleId` a game passes to `acquire`. */
    id: string;
    /** Artifact base name: the glue is `<file>.js`, the binary `<file>.wasm`. */
    file: string;
    /** Global the emscripten glue assigns its factory to (`EXPORT_NAME`); absent
     *  when the glue is an ES module whose default export is the factory. */
    globalName?: string;
    /** Absolute directory holding the build for the platform asked about, or null
     *  when this module has no build for it. */
    buildDir: string | null;
}

/**
 * Which build directory serves a target.
 *
 * `web` covers desktop and playable too — all three run the same web glue in the
 * same JS engine. Mini-game vendors share `wechat`, which is where the engine's
 * own WXWebAssembly builds already live; a vendor whose runtime genuinely
 * differs can be given its own directory by id, checked first.
 */
function buildDirNames(platform: ExportPlatform): string[] {
    if (platform === 'web' || platform === 'desktop' || platform === 'playable') return ['web'];
    if (platform === 'wechat') return ['wechat'];
    // A project's own mini-game vendor: its id first, then the WeChat build,
    // which is what every mini-game host's toolchain is a variant of.
    return [platform, 'wechat', 'web'];
}

interface ModuleManifest {
    file?: string;
    globalName?: string;
}

/**
 * Every module a project declares, with the build that serves `platform`
 * resolved (or null). Returns empty when the project declares none, which is
 * every project that never asked for this.
 */
export async function loadProjectModules(root: string, platform: ExportPlatform): Promise<ProjectModule[]> {
    const dir = path.join(root, PROJECT_MODULES_DIR);
    if (!existsSync(dir)) return [];
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const modules: ProjectModule[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const moduleDir = path.join(dir, entry.name);
        let manifest: ModuleManifest = {};
        try {
            manifest = JSON.parse(await readFile(path.join(moduleDir, 'module.json'), 'utf8')) as ModuleManifest;
        } catch {
            // No manifest, or unreadable: the directory name is still the id and
            // the artifact base defaults to it, so a module whose files follow
            // the convention needs no manifest at all.
        }
        const file = typeof manifest.file === 'string' && manifest.file !== '' ? manifest.file : entry.name;
        const buildDir = buildDirNames(platform)
            .map((name) => path.join(moduleDir, name))
            .find((candidate) => existsSync(path.join(candidate, `${file}.js`))) ?? null;
        const module: ProjectModule = { id: entry.name, file, buildDir };
        if (typeof manifest.globalName === 'string' && manifest.globalName !== '') {
            module.globalName = manifest.globalName;
        }
        modules.push(module);
    }
    return modules;
}

/**
 * What goes into `game.config.json` so the runtime can resolve these ids.
 *
 * Takes the platform to hold one invariant: a module is declared only if it was
 * STAGED. A declaration for a binary that is not in the package is worse than no
 * declaration — `acquire` would resolve the id, try to load a file that does not
 * exist, and report a missing artifact instead of an unsupported target.
 */
export function sideModuleDeclarations(
    modules: readonly ProjectModule[],
    platform: ExportPlatform,
): Array<{ id: string; file: string; globalName?: string }> {
    if (isNativePlatform(platform)) return [];
    return modules
        .filter((m) => m.buildDir)
        .map((m) => (m.globalName ? { id: m.id, file: m.file, globalName: m.globalName } : { id: m.id, file: m.file }));
}

/**
 * Stage each module's glue + binary into the package's `wasm/` directory —
 * beside the engine's own, because every transport already looks there and a
 * second location would be a second thing to get right per realm.
 *
 * Returns warnings for modules with no build for this target, named, since the
 * failure they cause otherwise happens at runtime on a device.
 */
export async function stageProjectModules(
    modules: readonly ProjectModule[],
    wasmOutDir: string,
    platform: ExportPlatform,
    /**
     * Rewrite the glue on the way in. Mini-game hosts reject syntax emscripten
     * emits by default (`?.`, `??`), and the export already down-levels the
     * engine's own glue for exactly that reason — a project module's glue is the
     * same kind of file and needs the same treatment, so the vendor's rule is
     * injected here rather than reimplemented.
     */
    transformJs?: (code: string) => Promise<string>,
): Promise<string[]> {
    const warnings: string[] = [];
    const staged = modules.filter((m) => m.buildDir);
    if (isNativePlatform(platform)) {
        // Native links its modules into the host binary at build time; there is no
        // load path for one that arrives with the content. Say so and stage
        // nothing, rather than shipping files that fail to load on a device.
        if (modules.length > 0) {
            warnings.push(`Project modules (${modules.map((m) => m.id).join(', ')}) are not packaged for `
                + 'native targets — the native host links its modules into the app binary, so one shipped '
                + 'with the content has no way to load. Build it into your native host instead.');
        }
        return warnings;
    }
    if (staged.length > 0) await mkdir(wasmOutDir, { recursive: true });
    for (const m of modules) {
        if (!m.buildDir) {
            warnings.push(`The project module "${m.id}" has no build for ${platform} `
                + `(looked for ${buildDirNames(platform).map((d) => `${d}/${m.file}.js`).join(' or ')} under `
                + `${PROJECT_MODULES_DIR}/${m.id}/) — it was not packaged, and acquiring it will fail at runtime.`);
            continue;
        }
        for (const ext of ['.js', '.wasm']) {
            const from = path.join(m.buildDir, `${m.file}${ext}`);
            if (!existsSync(from)) {
                // The glue is what the lookup keyed on, so a missing .wasm is the
                // real case here: an emscripten build with the binary embedded in
                // the glue is legal, so this is not fatal.
                if (ext === '.wasm') continue;
                warnings.push(`The project module "${m.id}" is missing ${m.file}${ext} in ${m.buildDir}.`);
                continue;
            }
            const to = path.join(wasmOutDir, `${m.file}${ext}`);
            if (ext === '.js' && transformJs) await writeFile(to, await transformJs(await readFile(from, 'utf8')));
            else await cp(from, to);
        }
    }
    return warnings;
}
