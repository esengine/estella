// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeZip } from '../../build-tools/utils/zip.js';
import {
    hostPlatform, installPlan, installTool, parseToolsIndex, removeTool, toolReady, toolSources, toolStatus, toolsManifest,
    type ToolsManifest,
} from '../src/tools/externalTools';
// @ts-expect-error — a plain script with no declarations
import { manifestProblems } from '../../tools/sync-external-tools.mjs';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Two small tools: `rt` (a runtime with an executable and a licence) and `gen`, which needs it. */
function fixture() {
    const rtZip = makeZip([
        { name: 'rt.exe', data: Buffer.from('MZ runtime') },
        { name: 'LICENSE.txt', data: Buffer.from('MIT') },
        { name: 'lib/core.dll', data: Buffer.from('core') },
    ]);
    const genZip = makeZip([{ name: 'Gen.dll', data: Buffer.from('gen') }]);
    const manifest: ToolsManifest = {
        formatVersion: 1,
        tools: {
            rt: {
                name: 'Runtime', version: '1.2.3', license: 'MIT', licenseFiles: ['LICENSE.txt'],
                executables: { 'win-x64': ['rt.exe'], 'linux-x64': ['rt.exe'] },
                files: {
                    'win-x64': { upstream: { url: 'https://vendor.example/rt-win.zip', bytes: 111, sha256: sha('rt-win-upstream') } },
                    'linux-x64': { upstream: { url: 'https://vendor.example/rt-linux.tar.gz', bytes: 222, sha256: sha('rt-linux-upstream') } },
                },
            },
            gen: {
                name: 'Generator', version: '5.1.0', license: 'MIT', licenseFiles: [], needs: ['rt'], entry: 'Gen.dll',
                files: { any: { upstream: { url: 'https://vendor.example/Gen.7z', bytes: 333, sha256: sha('gen-upstream') } } },
            },
        },
    };
    const index = {
        kind: 'estella-external-tools', formatVersion: 1, engineVersion: '9.9.9',
        files: [
            { tool: 'rt', version: '1.2.3', platform: 'win-x64', file: 'rt-1.2.3-win-x64.zip', bytes: rtZip.length, sha256: sha(rtZip), upstreamSha256: sha('rt-win-upstream') },
            { tool: 'gen', version: '5.1.0', platform: 'any', file: 'gen-5.1.0-any.zip', bytes: genZip.length, sha256: sha(genZip), upstreamSha256: sha('gen-upstream') },
        ],
    };
    return { manifest, rtZip, genZip, index };
}

let temp: string;
let base: string;
let store: string;
beforeEach(() => {
    temp = mkdtempSync(path.join(tmpdir(), 'estella-tools-'));
    base = path.join(temp, 'mirror');
    store = path.join(temp, 'store');
    mkdirSync(base);
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

function publish(f: ReturnType<typeof fixture>, index = f.index) {
    writeFileSync(path.join(base, 'rt-1.2.3-win-x64.zip'), f.rtZip);
    writeFileSync(path.join(base, 'gen-5.1.0-any.zip'), f.genZip);
    writeFileSync(path.join(base, 'external-tools.json'), JSON.stringify(index));
}
const env = () => ({ ESTELLA_TOOLS_BASE: base }) as NodeJS.ProcessEnv;

describe('which machine, which tool', () => {
    it('maps this machine to a pinned platform, or to none', () => {
        expect(hostPlatform('win32', 'x64')).toBe('win-x64');
        expect(hostPlatform('darwin', 'arm64')).toBe('osx-arm64');
        expect(hostPlatform('darwin', 'x64')).toBe('osx-x64');
        expect(hostPlatform('linux', 'arm64')).toBe('linux-arm64');
        expect(hostPlatform('win32', 'arm64')).toBeNull();
        expect(hostPlatform('freebsd', 'x64')).toBeNull();
    });

    it('the manifest the engine ships is whole: every file pinned, every need present', () => {
        expect(manifestProblems(toolsManifest())).toEqual([]);
        expect(Object.keys(toolsManifest().tools)).toEqual(expect.arrayContaining(['dotnet', 'luban']));
    });

    it('a manifest that is not pinned, or names something that is not there, says so', () => {
        const bad = structuredClone(toolsManifest());
        bad.tools.luban!.files.any!.upstream.sha256 = null as unknown as string;
        bad.tools.luban!.needs = ['nothing'];
        const problems = manifestProblems(bad) as string[];
        expect(problems.some((p) => /luban any: not pinned/.test(p))).toBe(true);
        expect(problems.some((p) => /needs "nothing"/.test(p))).toBe(true);
    });
});

describe('what a project is told before anything is fetched', () => {
    it('lists the tool and what it needs, runtime first, and drops what is already here', async () => {
        const f = fixture();
        publish(f);
        const before = installPlan('gen', { manifest: f.manifest, platform: 'win-x64', store, env: env() });
        expect(before.items.map((i) => i.id)).toEqual(['rt', 'gen']);
        expect(before.items[0]).toMatchObject({ version: '1.2.3', upstreamBytes: 111, license: 'MIT' });
        expect(before.sources).toEqual([base]);

        expect((await installTool('rt', { manifest: f.manifest, platform: 'win-x64', store, env: env() })).ok).toBe(true);
        const after = installPlan('gen', { manifest: f.manifest, platform: 'win-x64', store, env: env() });
        expect(after.items.map((i) => i.id)).toEqual(['gen']);
    });

    it('is empty when nothing is missing, and when the machine has no pinned build', async () => {
        const f = fixture();
        publish(f);
        expect((await installTool('gen', { manifest: f.manifest, platform: 'win-x64', store, env: env() })).ok).toBe(true);
        expect(installPlan('gen', { manifest: f.manifest, platform: 'win-x64', store, env: env() }).items).toEqual([]);
        expect(installPlan('gen', { manifest: f.manifest, platform: null, store, env: env() }).items).toEqual([]);
        expect(toolStatus('rt', { manifest: f.manifest, platform: null, store }).problem).toMatch(/no Runtime build is pinned for this machine/);
    });

    it('asks only the release sources by default, never the vendor', () => {
        const sources = toolSources({}, '9.9.9');
        expect(sources.length).toBeGreaterThan(0);
        for (const s of sources) {
            expect(s).toMatch(/\/v9\.9\.9$/);
            expect(s).not.toMatch(/microsoft|focus-creative-games|vendor/);
        }
        expect(sources.some((s) => s.startsWith('https://dl.estella.games'))).toBe(true);
        expect(toolSources({ ESTELLA_TOOLS_BASE: '/some/dir/' }, '9.9.9')).toEqual(['/some/dir']);
    });
});

describe('installing', () => {
    it('installs a tool and what it needs, verified, and finds them afterwards', async () => {
        const f = fixture();
        publish(f);
        const got = await installTool('gen', { manifest: f.manifest, platform: 'win-x64', store, env: env() });
        expect(got).toEqual({ ok: true, installed: ['rt 1.2.3', 'gen 5.1.0'] });
        const status = toolStatus('gen', { manifest: f.manifest, platform: 'win-x64', store });
        expect(status.installed).toBe(true);
        expect(status.needs[0]!.installed).toBe(true);
        expect(toolReady(status)).toBe(true);
        expect(readFileSync(path.join(status.dir!, 'Gen.dll'), 'utf8')).toBe('gen');
        expect(existsSync(path.join(status.needs[0]!.dir!, 'lib', 'core.dll'))).toBe(true);
        // No staging is left behind.
        expect(readdirSync(store).filter((n) => n.startsWith('.'))).toEqual([]);
    });

    it('reports a tool whose dependency is missing as not ready', async () => {
        const f = fixture();
        publish(f);
        await installTool('gen', { manifest: f.manifest, platform: 'win-x64', store, env: env() });
        expect(removeTool('rt', store)).toBe(false); // not in this manifest's store layout under the real manifest
        rmSync(path.join(store, 'rt'), { recursive: true });
        const status = toolStatus('gen', { manifest: f.manifest, platform: 'win-x64', store });
        expect(status.installed).toBe(true);
        expect(toolReady(status)).toBe(false);
    });

    it('refuses a file that does not hash to what the index says, and installs nothing', async () => {
        const f = fixture();
        publish(f);
        const tampered = Buffer.from(f.rtZip);
        tampered[tampered.length - 30] ^= 0xff;
        writeFileSync(path.join(base, 'rt-1.2.3-win-x64.zip'), tampered);
        const got = await installTool('rt', { manifest: f.manifest, platform: 'win-x64', store, env: env() });
        expect(got.ok).toBe(false);
        expect(got.error).toMatch(/checksum mismatch/);
        expect(toolStatus('rt', { manifest: f.manifest, platform: 'win-x64', store }).installed).toBe(false);
    });

    it('refuses a file of the wrong size', async () => {
        const f = fixture();
        publish(f);
        writeFileSync(path.join(base, 'rt-1.2.3-win-x64.zip'), Buffer.concat([f.rtZip, Buffer.from('extra')]));
        const got = await installTool('rt', { manifest: f.manifest, platform: 'win-x64', store, env: env() });
        expect(got.error).toMatch(/bytes, the index says/);
    });

    it('refuses an index that was made from a different vendor file than the one this engine pins', async () => {
        const f = fixture();
        const other = structuredClone(f.index);
        other.files[0]!.upstreamSha256 = sha('some-other-runtime');
        publish(f, other);
        const got = await installTool('rt', { manifest: f.manifest, platform: 'win-x64', store, env: env() });
        expect(got.ok).toBe(false);
        expect(got.error).toMatch(/different vendor file than this engine pins/);
    });

    it('refuses an index for another version of the tool, or one that has no file for this machine', async () => {
        const f = fixture();
        const old = structuredClone(f.index);
        old.files[0]!.version = '1.2.2';
        publish(f, old);
        expect((await installTool('rt', { manifest: f.manifest, platform: 'win-x64', store, env: env() })).error).toMatch(/no Runtime 1\.2\.3 for win-x64/);
        publish(f);
        const none = await installTool('rt', { manifest: f.manifest, platform: 'linux-x64', store, env: env() });
        expect(none.ok).toBe(false);
    });

    it('refuses an archive that lacks its executable or its licence', async () => {
        const f = fixture();
        const thin = makeZip([{ name: 'LICENSE.txt', data: Buffer.from('MIT') }]);
        const idx = structuredClone(f.index);
        idx.files[0]!.bytes = thin.length;
        idx.files[0]!.sha256 = sha(thin);
        publish(f, idx);
        writeFileSync(path.join(base, 'rt-1.2.3-win-x64.zip'), thin);
        const got = await installTool('rt', { manifest: f.manifest, platform: 'win-x64', store, env: env() });
        expect(got.error).toMatch(/incomplete archive — missing rt\.exe/);
    });

    it('refuses an archive that writes outside its folder', async () => {
        const f = fixture();
        const evil = makeZip([{ name: '../escaped.txt', data: Buffer.from('x') }, { name: 'rt.exe', data: Buffer.from('x') }]);
        const idx = structuredClone(f.index);
        idx.files[0]!.bytes = evil.length;
        idx.files[0]!.sha256 = sha(evil);
        publish(f, idx);
        writeFileSync(path.join(base, 'rt-1.2.3-win-x64.zip'), evil);
        const got = await installTool('rt', { manifest: f.manifest, platform: 'win-x64', store, env: env() });
        expect(got.error).toMatch(/unsafe ZIP entry name/);
        expect(existsSync(path.join(store, 'escaped.txt'))).toBe(false);
        expect(existsSync(path.join(temp, 'escaped.txt'))).toBe(false);
    });

    it('goes on to the next source when one fails its checks, over HTTP', async () => {
        const f = fixture();
        const served = new Map<string, Buffer>([
            ['https://good.example/v9.9.9/external-tools.json', Buffer.from(JSON.stringify(f.index))],
            ['https://good.example/v9.9.9/rt-1.2.3-win-x64.zip', f.rtZip],
            ['https://stale.example/v9.9.9/external-tools.json', Buffer.from(JSON.stringify(f.index))],
            ['https://stale.example/v9.9.9/rt-1.2.3-win-x64.zip', Buffer.from('a captive portal login page')],
        ]);
        const fetchImpl = (async (url: string) => {
            const body = served.get(url);
            return body ? new Response(new Uint8Array(body), { status: 200 }) : new Response('nope', { status: 404 });
        }) as unknown as typeof fetch;
        const got = await installTool('rt', {
            manifest: f.manifest, platform: 'win-x64', store, fetchImpl, engineVersion: '9.9.9',
            env: { ESTELLA_RELEASE_MIRROR: 'https://stale.example,https://good.example' } as NodeJS.ProcessEnv,
        });
        expect(got).toEqual({ ok: true, installed: ['rt 1.2.3'] });
    });

    it('says why when every source fails', async () => {
        const f = fixture();
        const got = await installTool('rt', { manifest: f.manifest, platform: 'win-x64', store, env: env() });
        expect(got.ok).toBe(false);
        expect(got.error).toMatch(/no tools index/);
    });

    it('removes a tool by id, and refuses an id it does not know', () => {
        mkdirSync(path.join(store, 'luban', '5.1.0', 'any'), { recursive: true });
        expect(removeTool('luban', store)).toBe(true);
        expect(existsSync(path.join(store, 'luban'))).toBe(false);
        expect(removeTool('../etc', store)).toBe(false);
    });
});

describe('the index', () => {
    it('keeps only entries that are well formed', () => {
        const f = fixture();
        const doc = { ...f.index, files: [...f.index.files, { tool: 'x', file: '../up.zip' }, { ...f.index.files[0], sha256: 'abc' }] };
        expect(parseToolsIndex(doc)!.length).toBe(2);
        expect(parseToolsIndex({ kind: 'something-else' })).toBeNull();
        expect(parseToolsIndex(null)).toBeNull();
        expect(parseToolsIndex({ ...f.index, formatVersion: 2 })).toBeNull();
        expect(parseToolsIndex({ ...f.index, files: [] })).toBeNull();
    });
});
