// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A web package installs the subsystems its content uses, and no others.
 *
 * Two halves that must stay together. Staging a subpath only lets the PAGE
 * resolve it; a subsystem is installed by something IMPORTING it, and on a lean
 * entry nothing else does. A package with the first half and not the second
 * boots, draws, and is quietly missing physics — which is how it shipped the
 * first time.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGame } from '../src/export/exportGame';
import { writeFakeSdkDist } from './fixtures/fakeSdkDist';
import type { ModuleChoice } from '../src/project/format';
import { moduleOfComponent } from '../src/project/targetSupport';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOSTS = path.join(HERE, '..', 'src', 'runtime');
const SCN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

/** The entries a real dist publishes, enough of them to tell apart. */
const SDK_FILES = {
    'index.js': 'export const full = 1;\n',
    'index.lean.js': 'export const lean = 1;\n',
    'wasm.js': 'export const wasm = 1;\n',
    'tilemap/index.js': 'export const tilemap = 1;\n',
    'ai/index.js': 'export const ai = 1;\n',
    'net/replication/index.js': 'export const repl = 1;\n',
    'shared/core.js': 'export const core = 1;\n',
};

function setup(components: string[]): { root: string; out: string } {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-installs-'));
    mkdirSync(path.join(root, 'scenes'), { recursive: true });
    writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({
        version: '1.0',
        entities: [{ name: 'Root', components: components.map((type) => ({ type })) }],
    }));
    writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'),
        JSON.stringify({ uuid: SCN, version: '2.0', type: 'scene', importer: {} }));
    writeFakeSdkDist(path.join(root, '_sdk'), SDK_FILES);
    mkdirSync(path.join(root, '_wasm'), { recursive: true });
    writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'export default () => {};');
    writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'ENGINE');
    writeFileSync(path.join(root, '_wasm', 'wasm.manifest.json'), JSON.stringify({ schema: 1 }));
    return { root, out: path.join(root, 'dist') };
}

const run = (f: { root: string; out: string }) => exportGame({
    root: f.root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
    sdkDistDir: path.join(f.root, '_sdk'), wasmDir: path.join(f.root, '_wasm'),
    outDir: f.out,
});

describe('a web package built on a lean entry', () => {
    it('imports the subsystem its content uses, not only resolves it', async () => {
        const f = setup(['Tilemap']);
        try {
            const res = await run(f);
            expect(res.errors).toEqual([]);
            const page = readFileSync(path.join(f.out, 'index.html'), 'utf8');
            const game = readFileSync(path.join(f.out, 'game.js'), 'utf8');
            expect(page).toContain('"esengine":"./sdk/index.lean.js"');
            expect(page).toContain('"esengine/tilemap":"./sdk/tilemap/index.js"');
            // The half a page cannot show: something has to IMPORT it.
            expect(game).toContain('import "esengine/tilemap"');
        } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    });

    it('carries the subpath it installs and leaves the rest behind', async () => {
        const f = setup(['Tilemap']);
        try {
            await run(f);
            const sdk = path.join(f.out, 'sdk');
            expect(existsSync(path.join(sdk, 'tilemap', 'index.js'))).toBe(true);
            expect(existsSync(path.join(sdk, 'index.lean.js'))).toBe(true);
            // A game with no agents and no session pays for neither.
            expect(existsSync(path.join(sdk, 'ai', 'index.js'))).toBe(false);
            expect(existsSync(path.join(sdk, 'net', 'replication', 'index.js'))).toBe(false);
            expect(existsSync(path.join(sdk, 'index.js'))).toBe(false);
        } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    });

    it('installs nothing when the content needs nothing optional', async () => {
        const f = setup(['Transform', 'Sprite']);
        try {
            await run(f);
            const page = readFileSync(path.join(f.out, 'index.html'), 'utf8');
            expect(page).toContain('"esengine":"./sdk/index.lean.js"');
            expect(page).not.toContain('esengine/tilemap');
            expect(readFileSync(path.join(f.out, 'game.js'), 'utf8')).not.toContain('import "esengine/');
        } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    });

    // Video is installed by no subpath, so the project takes the whole entry —
    // and then the page must name every subpath, because the whole entry has
    // already carried every subsystem into the package.
    it('falls back to the whole entry for a subsystem no subpath installs', async () => {
        const f = setup(['Video']);
        try {
            await run(f);
            const page = readFileSync(path.join(f.out, 'index.html'), 'utf8');
            expect(page).toContain('"esengine":"./sdk/index.js"');
            expect(page).toContain('"esengine/ai"');
            expect(existsSync(path.join(f.out, 'sdk', 'index.js'))).toBe(true);
        } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    });

    // A dist from before the split has no lean entry; pointing `esengine` at a
    // file that is not there is a package that cannot boot at all.
    it('takes the whole entry when the SDK build produced no lean one', async () => {
        const f = setup(['Tilemap']);
        try {
            rmSync(path.join(f.root, '_sdk'), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
            writeFakeSdkDist(path.join(f.root, '_sdk'),
                Object.fromEntries(Object.entries(SDK_FILES).filter(([k]) => k !== 'index.lean.js')));
            await run(f);
            const page = readFileSync(path.join(f.out, 'index.html'), 'utf8');
            expect(page).toContain('"esengine":"./sdk/index.js"');
        } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    });
});

/**
 * A module a project refused, against content that uses it.
 *
 * The package this would otherwise make boots and draws and is missing the
 * subsystem its own scene needs, with nothing saying which one — so the export
 * refuses to make it, and names what argued.
 */
describe('a web package whose project excluded a module', () => {
    /** The export takes what the project said as an option, the way it takes every
     *  other project-derived setting; `packagingOptionsOf` is what derives it. */
    const withChoice = (components: string[], modules: Record<string, ModuleChoice>) => ({
        ...setup(components), features: { modules },
    });
    const runWith = (f: ReturnType<typeof withChoice>) => exportGame({
        root: f.root, entryScene: 'scenes/main.esscene', hostsDir: HOSTS, packagesDir: OFFICIAL_PACKAGES,
        sdkDistDir: path.join(f.root, '_sdk'), wasmDir: path.join(f.root, '_wasm'),
        outDir: f.out, features: f.features,
    });

    it('fails, naming the module and what said the project uses it', async () => {
        const f = withChoice(['Tilemap'], { 'esengine/tilemap': 'exclude' });
        try {
            const res = await runWith(f);
            expect(res.ok).toBe(false);
            expect(res.errors.join('\n')).toContain('esengine/tilemap is excluded');
            expect(res.errors.join('\n')).toContain('a tilemap component in the content');
        } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    });

    it('builds when the excluded module is one the content does not use', async () => {
        const f = withChoice(['Tilemap'], { 'esengine/ai': 'exclude' });
        try {
            const res = await runWith(f);
            expect(res.errors).toEqual([]);
            expect(readFileSync(path.join(f.out, 'game.js'), 'utf8')).toContain('import "esengine/tilemap"');
        } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    });

    // What `include` is for: a module only a script reaches, which no scan sees.
    it('installs one the project forced in although nothing detected it', async () => {
        const f = withChoice(['Transform'], { 'esengine/replication': 'include' });
        try {
            await runWith(f);
            expect(readFileSync(path.join(f.out, 'game.js'), 'utf8'))
                .toContain('import "esengine/replication"');
        } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    });
});

/**
 * The page shows the components its documents carry; the build has more evidence
 * than that. So the two are not equal — but everything the page calls used has
 * to be installed, or a creator is told a module ships and it does not.
 */
describe('what the page says and what the build installs', () => {
    const pageWouldSay = (components: string[]): string[] => {
        const used = new Set<string>();
        for (const name of components) {
            const module = moduleOfComponent(name);
            if (module !== null) used.add(module);
        }
        return [...used].sort();
    };

    it('agree for content that uses several modules', async () => {
        const f = setup(['Tilemap', 'NavAgent', 'Health']);
        try {
            await run(f);
            const page = pageWouldSay(['Tilemap', 'NavAgent', 'Health']);
            expect(page).toEqual(['esengine/ai', 'esengine/gameplay', 'esengine/tilemap']);
            const game = readFileSync(path.join(f.out, 'game.js'), 'utf8');
            for (const module of page) expect(game).toContain(`import ${JSON.stringify(module)}`);
        } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    });

    it('agree that nothing optional is used, for content that uses none', async () => {
        const f = setup(['Transform', 'Sprite']);
        try {
            await run(f);
            expect(pageWouldSay(['Transform', 'Sprite'])).toEqual([]);
            expect(readFileSync(path.join(f.out, 'game.js'), 'utf8')).not.toContain('import "esengine/');
        } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
    });
});
