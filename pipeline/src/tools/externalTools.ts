// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  externalTools.ts — the third-party tools a project can switch on, found, fetched and checked.
 *
 * `external-tools.manifest.json` (repo root) pins each tool to one exact vendor file. A project that
 * turns a tool on gets exactly that: it is looked for in the user's tool store, and when it is missing
 * the caller is handed a PLAN (what would be fetched, and from where) to put in front of the person
 * before anything is downloaded. Nothing here downloads on its own.
 *
 * Where a file comes from is the release mirror (dl.estella.games) and then the engine release itself,
 * the same sources the native runtime templates use. There is no fallback to the vendor's site: the
 * release publishes an index naming each file's size and SHA-256 and the vendor file it was made from,
 * and a file that does not match the index, or an index that names a different vendor file than the one
 * this engine pins, is refused. A wrong or stale mirror therefore costs a failed download, never a
 * different tool.
 */
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { estellaDataDir, releaseAssetBases } from '../../../build-tools/utils/nativeTemplate.js';
import { extractZip } from '../../../build-tools/utils/zip.js';
import manifestJson from '../../../external-tools.manifest.json';

export type ToolPlatform = 'win-x64' | 'linux-x64' | 'linux-arm64' | 'osx-x64' | 'osx-arm64' | 'any';

interface UpstreamPin { url: string; bytes: number; sha256: string }
interface ToolEntry {
    name: string;
    version: string;
    license: string;
    licenseFiles: string[];
    needs?: string[];
    entry?: string;
    executables?: Partial<Record<ToolPlatform, string[]>>;
    files: Partial<Record<ToolPlatform, { upstream: UpstreamPin }>>;
}
export interface ToolsManifest { formatVersion: number; tools: Record<string, ToolEntry> }

export const TOOLS_INDEX = 'external-tools.json';
/** A base (URL or directory) that holds the index and the archives, replacing the release sources. For CI, an offline share and tests. */
export const TOOLS_BASE_ENV = 'ESTELLA_TOOLS_BASE';
/** Where tools are kept. */
export const TOOLS_STORE_ENV = 'ESTELLA_TOOLS_DIR';
const MARKER = '.estella-tool.json';

export function toolsManifest(): ToolsManifest {
    return manifestJson as unknown as ToolsManifest;
}

export function toolIds(manifest = toolsManifest()): string[] {
    return Object.keys(manifest.tools);
}

/** The platform key this machine's builds use, or null when no tool is pinned for it. */
export function hostPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): ToolPlatform | null {
    const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'osx' : platform === 'linux' ? 'linux' : null;
    const cpu = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
    if (!os || !cpu) return null;
    const key = `${os}-${cpu}`;
    return key === 'win-x64' || key === 'linux-x64' || key === 'linux-arm64' || key === 'osx-x64' || key === 'osx-arm64' ? key : null;
}

export function toolStoreDir(env: NodeJS.ProcessEnv = process.env): string {
    return env[TOOLS_STORE_ENV] || path.join(estellaDataDir(), 'tools');
}

/** The key of this tool's file for a machine: its own platform's, or the one built for every platform. */
function fileKey(tool: ToolEntry, platform: ToolPlatform): ToolPlatform | null {
    if (tool.files[platform]) return platform;
    if (tool.files.any) return 'any';
    return null;
}

export interface ToolStatus {
    id: string;
    name: string;
    version: string;
    license: string;
    installed: boolean;
    /** Where it is, when it is. */
    dir?: string;
    /** Why it is not usable, when it is not. */
    problem?: string;
    /** What it needs, and whether that is in place. */
    needs: ToolStatus[];
}

interface Marker { tool: string; version: string; platform: string; upstreamSha256: string; sha256: string }

function readMarker(dir: string): Marker | null {
    try { return JSON.parse(readFileSync(path.join(dir, MARKER), 'utf8')) as Marker; } catch { return null; }
}

interface Where { platform?: ToolPlatform | null; manifest?: ToolsManifest; store?: string }

/** Is `id` installed, whole, and the version this engine pins? Looks only at the disk. */
export function toolStatus(id: string, options: Where = {}): ToolStatus {
    const manifest = options.manifest ?? toolsManifest();
    const tool = manifest.tools[id];
    if (!tool) throw new Error(`unknown tool "${id}"`);
    const platform = options.platform === undefined ? hostPlatform() : options.platform;
    const base = { id, name: tool.name, version: tool.version, license: tool.license };
    const needs = (tool.needs ?? []).map((n) => toolStatus(n, options));
    if (!platform) return { ...base, installed: false, problem: `no ${tool.name} build is pinned for this machine (${process.platform}/${process.arch})`, needs };
    const key = fileKey(tool, platform);
    if (!key) return { ...base, installed: false, problem: `no ${tool.name} build is pinned for ${platform}`, needs };
    const dir = path.join(options.store ?? toolStoreDir(), id, tool.version, key);
    const marker = readMarker(dir);
    const pin = tool.files[key]!.upstream;
    if (!marker) return { ...base, installed: false, problem: 'not installed', needs };
    if (marker.version !== tool.version || marker.upstreamSha256 !== pin.sha256) {
        return { ...base, installed: false, dir, problem: 'installed from a different file than this engine pins', needs };
    }
    const wanted = [...(tool.executables?.[platform] ?? []), ...(tool.entry ? [tool.entry] : [])];
    const missing = wanted.filter((f) => !existsSync(path.join(dir, f)));
    if (missing.length) return { ...base, installed: false, dir, problem: `incomplete — missing ${missing.join(', ')}`, needs };
    return { ...base, installed: true, dir, needs };
}

/** Usable only when it and everything it needs are. */
export function toolReady(status: ToolStatus): boolean {
    return status.installed && status.needs.every(toolReady);
}

export interface PlanItem {
    id: string;
    name: string;
    version: string;
    platform: ToolPlatform;
    license: string;
    /** The vendor's file this is made from, so a person can see what it is. */
    upstreamUrl: string;
    /** The vendor file's size: the download is about this big (the mirror's zip is a little different). */
    upstreamBytes: number;
}

export interface InstallPlan {
    /** What would be fetched, what it needs first. Empty when everything is in place. */
    items: PlanItem[];
    /** Where from, in the order tried. */
    sources: string[];
}

export function toolSources(env: NodeJS.ProcessEnv = process.env, engineVersion = defaultEngineVersion()): string[] {
    const override = env[TOOLS_BASE_ENV];
    return override ? [override.replace(/[\\/]+$/, '')] : (releaseAssetBases(engineVersion, env) as string[]);
}

function defaultEngineVersion(): string {
    try {
        // The repo root's package.json when running from source; the editor passes its own version.
        return (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
    } catch {
        return '0.0.0';
    }
}

/** What turning `id` on would fetch: the tool and whatever it needs that is not here yet. Touches no network. */
export function installPlan(id: string, options: Where & { env?: NodeJS.ProcessEnv; engineVersion?: string } = {}): InstallPlan {
    const manifest = options.manifest ?? toolsManifest();
    const platform = options.platform === undefined ? hostPlatform() : options.platform;
    const items: PlanItem[] = [];
    const seen = new Set<string>();
    const visit = (toolId: string): void => {
        if (seen.has(toolId)) return;
        seen.add(toolId);
        const tool = manifest.tools[toolId];
        if (!tool) throw new Error(`unknown tool "${toolId}"`);
        for (const need of tool.needs ?? []) visit(need);
        if (!platform) return;
        if (toolStatus(toolId, { ...options, platform }).installed) return;
        const key = fileKey(tool, platform);
        if (!key) return;
        const up = tool.files[key]!.upstream;
        items.push({ id: toolId, name: tool.name, version: tool.version, platform: key, license: tool.license, upstreamUrl: up.url, upstreamBytes: up.bytes });
    };
    visit(id);
    return { items, sources: toolSources(options.env ?? process.env, options.engineVersion) };
}

// ---- The index a release publishes -----------------------------------------------------------------

export interface IndexFile { tool: string; version: string; platform: string; file: string; bytes: number; sha256: string; upstreamSha256: string }

export function parseToolsIndex(doc: unknown): IndexFile[] | null {
    const d = doc as { kind?: unknown; formatVersion?: unknown; files?: unknown } | null;
    if (!d || d.kind !== 'estella-external-tools' || d.formatVersion !== 1 || !Array.isArray(d.files)) return null;
    const ok = (d.files as IndexFile[]).filter((f) => typeof f?.tool === 'string' && typeof f.version === 'string' && typeof f.platform === 'string'
        && typeof f.file === 'string' && /^[\w.-]+$/.test(f.file)
        && typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256)
        && typeof f.upstreamSha256 === 'string' && /^[0-9a-f]{64}$/.test(f.upstreamSha256)
        && Number.isInteger(f.bytes) && f.bytes > 0);
    return ok.length > 0 ? ok : null;
}

type Read = { ok: true; stream: AsyncIterable<Uint8Array> } | { ok: false; error: string };

async function readBase(base: string, name: string, fetchImpl: typeof fetch): Promise<Read> {
    if (/^https?:\/\//.test(base)) {
        const res = await fetchImpl(`${base}/${name}`);
        if (!res.ok || !res.body) return { ok: false, error: `HTTP ${res.status} for ${name}` };
        return { ok: true, stream: res.body as unknown as AsyncIterable<Uint8Array> };
    }
    const file = path.join(base, name);
    if (!existsSync(file)) return { ok: false, error: `${file} does not exist` };
    const bytes = readFileSync(file);
    return { ok: true, stream: (async function* () { yield new Uint8Array(bytes); })() };
}

async function readAll(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
    const parts: Buffer[] = [];
    for await (const chunk of stream) parts.push(Buffer.from(chunk));
    return Buffer.concat(parts);
}

export interface ToolProgress { tool: string; received: number; total: number }
export interface InstallResult { ok: boolean; installed: string[]; error?: string }

/**
 * Fetch and install `id` and what it needs, verified. Never throws: a failure is a message.
 * Sources are tried in order; a source that fails any check is skipped for the next.
 */
export async function installTool(id: string, options: Where & {
    env?: NodeJS.ProcessEnv;
    engineVersion?: string;
    fetchImpl?: typeof fetch;
    onProgress?: (progress: ToolProgress) => void;
} = {}): Promise<InstallResult> {
    const manifest = options.manifest ?? toolsManifest();
    const platform = options.platform === undefined ? hostPlatform() : options.platform;
    const store = options.store ?? toolStoreDir(options.env);
    const fetchImpl = options.fetchImpl ?? fetch;
    if (!platform) return { ok: false, installed: [], error: `no tools are pinned for this machine (${process.platform}/${process.arch})` };
    const plan = installPlan(id, { ...options, manifest, platform, store });
    const installed: string[] = [];
    for (const item of plan.items) {
        let last = `no source for ${item.name}`;
        let done = false;
        for (const base of plan.sources) {
            const attempt = await installFrom(base, item, manifest, store, platform, fetchImpl, options.onProgress);
            if (attempt === null) { done = true; break; }
            last = attempt;
            if (plan.sources.length > 1) console.warn(`[tools] ${base}: ${last}`);
        }
        if (!done) return { ok: false, installed, error: last };
        installed.push(`${item.id} ${item.version}`);
    }
    return { ok: true, installed };
}

/** Null on success; otherwise why this source did not work. */
async function installFrom(base: string, item: PlanItem, manifest: ToolsManifest, store: string, platform: ToolPlatform, fetchImpl: typeof fetch, onProgress?: (p: ToolProgress) => void): Promise<string | null> {
    const tool = manifest.tools[item.id]!;
    const pin = tool.files[item.platform]!.upstream;
    const staging = path.join(store, `.incoming-${randomUUID()}`);
    try {
        const indexRead = await readBase(base, TOOLS_INDEX, fetchImpl);
        if (!indexRead.ok) return `no tools index (${indexRead.error})`;
        const entries = parseToolsIndex(JSON.parse((await readAll(indexRead.stream)).toString('utf8')));
        if (!entries) return 'the tools index is not readable';
        const entry = entries.find((e) => e.tool === item.id && e.platform === item.platform && e.version === tool.version);
        if (!entry) return `the index has no ${item.name} ${tool.version} for ${item.platform}`;
        // The index may name only the vendor file this engine pins. That is what makes the version fixed.
        if (entry.upstreamSha256 !== pin.sha256) return `the index's ${item.name} is made from a different vendor file than this engine pins`;

        const fileRead = await readBase(base, entry.file, fetchImpl);
        if (!fileRead.ok) return `download failed (${fileRead.error})`;
        mkdirSync(staging, { recursive: true });
        const archive = path.join(staging, entry.file);
        const digest = createHash('sha256');
        let received = 0;
        const sink = createWriteStream(archive);
        for await (const chunk of fileRead.stream) {
            digest.update(chunk);
            received += chunk.byteLength;
            onProgress?.({ tool: item.id, received, total: entry.bytes });
            if (!sink.write(chunk)) await once(sink, 'drain');
        }
        await new Promise<void>((resolve, reject) => sink.end((err?: Error) => (err ? reject(err) : resolve())));
        if (received !== entry.bytes) return `download is ${received} bytes, the index says ${entry.bytes}`;
        const got = digest.digest('hex');
        if (got !== entry.sha256) return `checksum mismatch — got ${got.slice(0, 16)}…, expected ${entry.sha256.slice(0, 16)}…`;

        const unpacked = path.join(staging, 'files');
        mkdirSync(unpacked, { recursive: true });
        extractZip(readFileSync(archive), unpacked);
        const executables = tool.executables?.[platform] ?? [];
        const required = [...executables, ...(tool.entry ? [tool.entry] : []), ...tool.licenseFiles];
        const missing = required.filter((f) => !existsSync(path.join(unpacked, f)));
        if (missing.length) return `incomplete archive — missing ${missing.join(', ')}`;
        if (process.platform !== 'win32') for (const exe of executables) chmodSync(path.join(unpacked, exe), 0o755);
        const marker: Marker = { tool: item.id, version: tool.version, platform: item.platform, upstreamSha256: pin.sha256, sha256: got };
        writeFileSync(path.join(unpacked, MARKER), JSON.stringify(marker, null, 2));

        const dest = path.join(store, item.id, tool.version, item.platform);
        rmSync(dest, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        mkdirSync(path.dirname(dest), { recursive: true });
        renameSync(unpacked, dest);
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    } finally {
        rmSync(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
}

/** Delete an installed tool (every version of it). Takes the id, never a path. */
export function removeTool(id: string, store = toolStoreDir()): boolean {
    if (!toolsManifest().tools[id]) return false;
    const dir = path.join(store, id);
    if (!existsSync(dir) || readdirSync(dir).length === 0) return false;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    return true;
}
