#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sync-external-tools.mjs — put the pinned third-party tools on the release mirror's terms.
 *
 * `external-tools.manifest.json` pins each tool to the exact file its vendor publishes. This script
 * turns those into what an engine release serves: one .zip per tool and platform (the single archive
 * format the engine reads, so it needs no extractor for .7z or .tar.gz) and an index that says what
 * each file must hash to. The files are attached to the release; `mirror-release.yml` copies them to
 * dl.estella.games beside everything else.
 *
 *   node tools/sync-external-tools.mjs --check            the manifest is well formed (offline; for gates)
 *   node tools/sync-external-tools.mjs --record           fill a missing size or SHA-256 from the vendor's file
 *   node tools/sync-external-tools.mjs [--out <dir>]      build the release files (default output/external-tools)
 *
 * A pin is never changed by this script: a vendor file that does not match its pin stops it. Changing a
 * pin is an edit to the manifest that ships with an engine version.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip, readZip, zipTree } from '../build-tools/utils/zip.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'external-tools.manifest.json');
export const PLATFORMS = ['win-x64', 'linux-x64', 'linux-arm64', 'osx-x64', 'osx-arm64', 'any'];
const SHA = /^[0-9a-f]{64}$/;

export function readManifest(file = MANIFEST) {
    return JSON.parse(readFileSync(file, 'utf8'));
}

/** What is wrong with the manifest as written, as sentences. Empty when it is fit to build from. */
export function manifestProblems(manifest, { requirePins = true } = {}) {
    const problems = [];
    if (manifest.formatVersion !== 1) problems.push(`formatVersion must be 1, not ${manifest.formatVersion}`);
    const tools = manifest.tools ?? {};
    for (const [id, tool] of Object.entries(tools)) {
        if (!/^[a-z][a-z0-9-]*$/.test(id)) problems.push(`tool id "${id}" must be lower-case letters, digits and hyphens`);
        if (typeof tool.version !== 'string' || !/^\d+(\.\d+)*$/.test(tool.version)) problems.push(`${id}: version "${tool.version}" is not a dotted number`);
        if (typeof tool.license !== 'string' || !tool.license) problems.push(`${id}: license is missing`);
        for (const need of tool.needs ?? []) if (!tools[need]) problems.push(`${id}: needs "${need}", which is not in the manifest`);
        const files = tool.files ?? {};
        if (Object.keys(files).length === 0) problems.push(`${id}: no files`);
        for (const [platform, file] of Object.entries(files)) {
            const where = `${id} ${platform}`;
            if (!PLATFORMS.includes(platform)) problems.push(`${where}: unknown platform`);
            const up = file.upstream;
            if (!up || typeof up.url !== 'string' || !up.url.startsWith('https://')) { problems.push(`${where}: upstream.url must be https`); continue; }
            if (up.bytes !== null && !(Number.isInteger(up.bytes) && up.bytes > 0)) problems.push(`${where}: upstream.bytes must be a positive integer`);
            if (up.sha256 !== null && !SHA.test(up.sha256 ?? '')) problems.push(`${where}: upstream.sha256 must be 64 hex digits`);
            if (requirePins && (up.bytes === null || up.sha256 === null)) problems.push(`${where}: not pinned yet — run tools/sync-external-tools.mjs --record`);
        }
        for (const [platform, exes] of Object.entries(tool.executables ?? {})) {
            if (!files[platform]) problems.push(`${id}: executables names ${platform}, which has no file`);
            if (!Array.isArray(exes) || exes.some((e) => typeof e !== 'string' || e.startsWith('/') || e.includes('..'))) problems.push(`${id} ${platform}: executables must be relative paths`);
        }
    }
    return problems;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url, cacheDir, expectedBytes) {
    const file = path.join(cacheDir, url.split('/').pop());
    if (existsSync(file)) return readFileSync(file);
    mkdirSync(cacheDir, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (expectedBytes && buf.length !== expectedBytes) throw new Error(`${url}: ${buf.length} bytes, expected ${expectedBytes}`);
    writeFileSync(file, buf);
    return buf;
}

// ---- Archive readers: everything becomes [{ name, data }] for makeZip ----------------------------

/** A tar archive's regular files. A link is followed to its target's bytes; one that cannot be is an error, not a gap. */
export function readTar(buf) {
    const files = new Map();
    const links = [];
    let longName = null;
    for (let at = 0; at + 512 <= buf.length;) {
        const header = buf.subarray(at, at + 512);
        if (header.every((b) => b === 0)) break;
        const field = (from, len) => header.subarray(from, from + len).toString('utf8').replace(/\0.*$/, '');
        const size = parseInt(field(124, 12).trim() || '0', 8);
        const type = String.fromCharCode(header[156] || 0x30);
        let name = field(0, 100);
        const prefix = field(345, 155);
        if (prefix) name = `${prefix}/${name}`;
        const body = buf.subarray(at + 512, at + 512 + size);
        at += 512 + Math.ceil(size / 512) * 512;
        if (type === 'L') { longName = body.toString('utf8').replace(/\0.*$/, ''); continue; }
        if (type === 'x' || type === 'g') continue;
        if (longName) { name = longName; longName = null; }
        name = name.replace(/^\.\//, '').replace(/\/+$/, '');
        if (!name) continue;
        if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`unsafe tar entry: ${name}`);
        if (type === '5') continue;
        if (type === '0' || type === '\0') files.set(name, Buffer.from(body));
        else if (type === '1' || type === '2') links.push({ name, type, target: field(157, 100) });
        else throw new Error(`tar entry ${name}: type "${type}" is not supported`);
    }
    for (const link of links) {
        const resolved = link.type === '1' ? link.target : path.posix.normalize(path.posix.join(path.posix.dirname(link.name), link.target));
        const data = files.get(resolved);
        if (!data) throw new Error(`tar link ${link.name} -> ${link.target} points at nothing in the archive`);
        files.set(link.name, data);
    }
    return [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, data]) => ({ name, data }));
}

function sevenZip() {
    const candidates = [process.env.ESTELLA_7Z, '7z', '7za', '7zz'].filter(Boolean);
    for (const bin of candidates) {
        const run = spawnSync(bin, ['--help'], { encoding: 'utf8' });
        if (!run.error && run.status !== null) return bin;
    }
    throw new Error('a .7z archive needs 7-Zip: put 7z (or 7za) on PATH, or point ESTELLA_7Z at it');
}

function read7z(buf) {
    const temp = mkdtempSync(path.join(tmpdir(), 'estella-7z-'));
    try {
        const archive = path.join(temp, 'in.7z');
        writeFileSync(archive, buf);
        const out = path.join(temp, 'out');
        const run = spawnSync(sevenZip(), ['x', '-y', `-o${out}`, archive], { encoding: 'utf8' });
        if (run.status !== 0) throw new Error(`7z failed: ${run.stderr || run.stdout}`);
        return zipTree(out);
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
}

function entriesOf(url, buf) {
    if (url.endsWith('.tar.gz')) return readTar(gunzipSync(buf));
    if (url.endsWith('.7z')) return read7z(buf);
    if (url.endsWith('.zip')) return readZip(buf).map(({ name, data }) => ({ name, data }));
    throw new Error(`${url}: do not know how to unpack this`);
}

/** Drop the one top-level folder an archive wraps everything in, so installs always see the same layout. */
function flatten(entries) {
    const tops = new Set(entries.map((e) => e.name.split('/')[0]));
    const wrapped = tops.size === 1 && entries.every((e) => e.name.includes('/'));
    return wrapped ? entries.map((e) => ({ ...e, name: e.name.split('/').slice(1).join('/') })) : entries;
}

// ---- Commands -------------------------------------------------------------------------------------

function parseArgs(argv) {
    const args = { mode: 'build', out: path.join(ROOT, 'output', 'external-tools'), cache: path.join(ROOT, '.cache', 'external-tools') };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--check') args.mode = 'check';
        else if (argv[i] === '--record') args.mode = 'record';
        else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
        else if (argv[i] === '--cache') args.cache = path.resolve(argv[++i]);
        else throw new Error(`unknown argument ${argv[i]}`);
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const manifest = readManifest();

    if (args.mode === 'check') {
        const problems = manifestProblems(manifest);
        if (problems.length) { console.error(`external-tools.manifest.json:\n  - ${problems.join('\n  - ')}`); process.exit(1); }
        const n = Object.values(manifest.tools).reduce((sum, t) => sum + Object.keys(t.files).length, 0);
        console.log(`external-tools: ${Object.keys(manifest.tools).length} tools, ${n} pinned files — ok`);
        return;
    }

    const structural = manifestProblems(manifest, { requirePins: false });
    if (structural.length) { console.error(`external-tools.manifest.json:\n  - ${structural.join('\n  - ')}`); process.exit(1); }

    if (args.mode === 'record') {
        let changed = 0;
        for (const [id, tool] of Object.entries(manifest.tools)) {
            for (const [platform, file] of Object.entries(tool.files)) {
                const up = file.upstream;
                const buf = await download(up.url, args.cache, up.bytes ?? undefined);
                const got = { bytes: buf.length, sha256: sha256(buf) };
                if (up.bytes !== null && up.bytes !== got.bytes) throw new Error(`${id} ${platform}: the vendor file is ${got.bytes} bytes, the pin says ${up.bytes}`);
                if (up.sha256 !== null && up.sha256 !== got.sha256) throw new Error(`${id} ${platform}: the vendor file hashes to ${got.sha256}, the pin says ${up.sha256}`);
                if (up.bytes === null || up.sha256 === null) { up.bytes = got.bytes; up.sha256 = got.sha256; changed++; console.log(`pinned ${id} ${platform}: ${got.bytes} bytes ${got.sha256}`); }
                else console.log(`ok     ${id} ${platform}`);
            }
        }
        if (changed) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 4) + '\n');
        console.log(changed ? `${changed} pin(s) recorded` : 'nothing to record');
        return;
    }

    const problems = manifestProblems(manifest);
    if (problems.length) { console.error(`external-tools.manifest.json:\n  - ${problems.join('\n  - ')}`); process.exit(1); }
    const engineVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    mkdirSync(args.out, { recursive: true });
    const index = { kind: 'estella-external-tools', formatVersion: 1, engineVersion, files: [] };
    for (const [id, tool] of Object.entries(manifest.tools)) {
        for (const [platform, file] of Object.entries(tool.files)) {
            const up = file.upstream;
            const buf = await download(up.url, args.cache, up.bytes);
            if (buf.length !== up.bytes || sha256(buf) !== up.sha256) throw new Error(`${id} ${platform}: the vendor file does not match its pin; refusing to publish it`);
            const entries = flatten(entriesOf(up.url, buf));
            if (entries.length === 0) throw new Error(`${id} ${platform}: the archive is empty`);
            for (const want of tool.executables?.[platform] ?? []) {
                if (!entries.some((e) => e.name === want)) throw new Error(`${id} ${platform}: ${want} is not in the archive`);
            }
            if (tool.entry && !entries.some((e) => e.name === tool.entry)) throw new Error(`${id} ${platform}: ${tool.entry} is not in the archive`);
            const zip = makeZip(entries);
            const name = `${id}-${tool.version}-${platform}.zip`;
            writeFileSync(path.join(args.out, name), zip);
            index.files.push({ tool: id, version: tool.version, platform, file: name, bytes: zip.length, sha256: sha256(zip), upstreamSha256: up.sha256 });
            console.log(`${name}  ${zip.length} bytes`);
        }
    }
    writeFileSync(path.join(args.out, 'external-tools.json'), JSON.stringify(index, null, 2) + '\n');
    console.log(`wrote ${index.files.length} files and external-tools.json to ${path.relative(ROOT, args.out)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
}
