// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    nativeTemplates.ts
 * @brief   The editor's half of the runtime-template contract: find one, install one.
 *
 * @details A native target's compiled half — the engine, Dawn, QuickJS, the Java
 *          shim — is the same for every game, so it is built once per release and
 *          shipped as a template rather than rebuilt by everyone who wants to put a
 *          game on a phone. The editor never compiles it; it looks one up and
 *          assembles the app around it.
 *
 *          The layout and the store path come from build-tools/utils/nativeTemplate.js,
 *          which the CLI's emitter reads too — so what is written and what is looked
 *          for cannot drift.
 */

import path from 'node:path';
import { existsSync, readFileSync, rmSync, renameSync, mkdirSync, readdirSync, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import {
    findTemplate, readTemplateManifest, missingTemplateFiles, installedTemplateDir,
    templateStoreDir, iosTemplateSources, releaseAssetBases, parseTemplateIndex,
    TEMPLATE_INDEX, templateSpineVersions,
    type TemplatePlatform, type NativeTemplateManifest,
} from '../../../build-tools/utils/nativeTemplate.js';
import { extractZip } from '../../../build-tools/utils/zip.js';

export type { NativeTemplateManifest };

/**
 * Which Spine skeletons a package ships will not play on a template, said as a
 * warning, or null when every one will. A host carries every vendored Spine
 * release, each reading the skeletons exported from it (#115); only a template
 * from before that, or one built with a narrowed --spine, lacks one. The package
 * is still assembled: the rest of the game runs, and the runtime names each
 * skeleton it cannot read. `target` names the template (`android`, `windows`, …).
 */
export function nativeSpineMismatch(
    skeletons: ReadonlyMap<string, readonly string[]>, templateDir: string, target: string,
): string | null {
    const carried = templateSpineVersions(readTemplateManifest(templateDir));
    const missing = [...skeletons].filter(([v]) => !carried.includes(v)).sort(([a], [b]) => a.localeCompare(b));
    if (missing.length === 0) return null;
    const files = missing.flatMap(([, paths]) => paths);
    const named = files.slice(0, 3).join(', ') + (files.length > 3 ? `, and ${files.length - 3} more` : '');
    return `${files.length} Spine skeleton${files.length === 1 ? ' is' : 's are'} ${missing.map(([v]) => v).join(' / ')} `
        + `(${named}), and the installed ${target} runtime template carries Spine ${carried.join(', ')} only, so `
        + `${files.length === 1 ? 'it does' : 'they do'} not play in this app. Install this editor version's ${target} `
        + 'runtime template from Package Project, then export again.';
}

/** A template this editor can actually use, with where it came from. */
export interface UsableTemplate {
    dir: string;
    manifest: NativeTemplateManifest;
}

/**
 * The runtime template for @p platform, or null when this machine has none for
 * this editor version.
 *
 * A template whose files are incomplete counts as absent: half a template
 * produces an app that fails to link, which is worse than one that is not offered.
 */
export function resolveNativeTemplate(platform: TemplatePlatform, engineVersion: string): UsableTemplate | null {
    const found = findTemplate({ platform, engineVersion });
    if (!found || found.missing.length > 0) return null;
    return { dir: found.dir, manifest: found.manifest };
}

/** The three files an iOS Xcode project is built around, or null without a template. */
export function iosSourcesFromTemplate(engineVersion: string): {
    xcframework: string; mainM: string; infoPlistIn: string; icon: string; bytecode: string;
} | null {
    const template = resolveNativeTemplate('ios', engineVersion);
    return template ? iosTemplateSources(template.dir) : null;
}

/** One row of the installed-template list. */
export interface NativeTemplateEntry {
    id: string;
    platform: string;
    /** Android: the architectures it carries. */
    abis: string[];
    engineVersion: string;
    /** The Spine releases the host carries; a skeleton of any other does not
     *  play on it (see {@link nativeSpineMismatch}). */
    spineVersions: string[];
    dir: string;
    /** Usable by THIS editor — an older release's template stays listed (removing
     *  it is the user's call) but cannot be packaged with. */
    current: boolean;
}

/** Every template installed on this machine, newest version first. */
export function listNativeTemplates(engineVersion: string): NativeTemplateEntry[] {
    const store = templateStoreDir();
    if (!existsSync(store)) return [];
    const out: NativeTemplateEntry[] = [];
    for (const version of readdirSync(store, { withFileTypes: true }).filter((e) => e.isDirectory())) {
        const versionDir = path.join(store, version.name);
        for (const entry of readdirSync(versionDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
            const dir = path.join(versionDir, entry.name);
            const manifest = readTemplateManifest(dir);
            if (!manifest) continue;
            out.push({
                id: manifest.id,
                platform: manifest.platform,
                abis: manifest.abis ?? [],
                engineVersion: manifest.engineVersion,
                spineVersions: templateSpineVersions(manifest),
                dir,
                current: manifest.engineVersion === engineVersion
                    && missingTemplateFiles(dir, manifest.platform).length === 0,
            });
        }
    }
    return out.sort((a, b) => b.engineVersion.localeCompare(a.engineVersion) || a.id.localeCompare(b.id));
}

export interface InstallResult {
    ok: boolean;
    id?: string;
    engineVersion?: string;
    dir?: string;
    /** Installed, but built for another release — it is stored under its own
     *  version and simply will not be offered until the editor matches. */
    versionMismatch?: boolean;
    error?: string;
}

/**
 * Install a template archive.
 *
 * Unpacked to a staging directory and validated BEFORE anything replaces an
 * installed template: a truncated download must not take out the working copy.
 * The archive is untrusted input, so entry names are checked by `extractZip`.
 */
export function installNativeTemplate(zipPath: string, engineVersion: string): InstallResult {
    const store = templateStoreDir();
    const staging = path.join(store, `.incoming-${randomUUID()}`);
    try {
        mkdirSync(staging, { recursive: true });
        extractZip(readFileSync(zipPath), staging);

        const manifest = readTemplateManifest(staging);
        if (!manifest) {
            return { ok: false, error: 'not an Estella runtime template (no readable template.json)' };
        }
        const missing = missingTemplateFiles(staging, manifest.platform);
        if (missing.length > 0) {
            return { ok: false, error: `incomplete template — missing ${missing.join(', ')}` };
        }

        const dest = installedTemplateDir(manifest.engineVersion, manifest.platform, store);
        rmSync(dest, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        mkdirSync(path.dirname(dest), { recursive: true });
        renameSync(staging, dest);
        return {
            ok: true,
            id: manifest.id,
            engineVersion: manifest.engineVersion,
            dir: dest,
            versionMismatch: manifest.engineVersion !== engineVersion,
        };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
        rmSync(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
}

/** How far a download has got, for the row that asked for it. */
export interface TemplateDownloadProgress {
    received: number;
    total: number;
}

/**
 * Download this editor version's runtime template for @p platform and install it.
 *
 * The release publishes an index beside the archives, so the editor asks what
 * exists for its own version rather than guessing a filename — and the index
 * carries a digest, which is checked before anything is unpacked. A download that
 * was truncated, cached wrong by a proxy or served as somebody's captive-portal
 * login page fails here, named, instead of installing as a broken template.
 *
 * Never throws: every failure is a message on the row that offered the button.
 */
export async function downloadNativeTemplate(
    platform: TemplatePlatform,
    engineVersion: string,
    options: {
        onProgress?: (progress: TemplateDownloadProgress) => void;
        fetchImpl?: typeof fetch;
        /** Where the archives live. Overridable for tests and for an offline mirror. */
        baseUrl?: string;
    } = {},
): Promise<InstallResult> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const bases = options.baseUrl ? [options.baseUrl] : releaseAssetBases(engineVersion);

    // Mirrors first, the origin last. A mirror that is stale, truncated, wrong or
    // simply down fails a check the archive has to pass anyway, and the next source
    // is tried — so a fast copy is a shortcut and never a risk.
    let lastError = `no source for v${engineVersion}`;
    for (const base of bases) {
        const attempt = await downloadFrom(base, platform, engineVersion, fetchImpl, options.onProgress);
        if (attempt.ok) return attempt;
        lastError = attempt.error ?? `download failed from ${base}`;
        if (bases.length > 1) console.warn(`[templates] ${base}: ${lastError}`);
    }
    return { ok: false, error: lastError };
}

async function downloadFrom(
    base: string,
    platform: TemplatePlatform,
    engineVersion: string,
    fetchImpl: typeof fetch,
    onProgress?: (progress: TemplateDownloadProgress) => void,
): Promise<InstallResult> {
    const staging = path.join(templateStoreDir(), `.download-${randomUUID()}`);

    try {
        const indexRes = await fetchImpl(`${base}/${TEMPLATE_INDEX}`);
        if (!indexRes.ok) {
            return { ok: false, error: `no template index for v${engineVersion} (HTTP ${indexRes.status})` };
        }
        const entries = parseTemplateIndex(await indexRes.json(), engineVersion);
        if (!entries) return { ok: false, error: `the template index for v${engineVersion} is not readable` };

        const entry = entries.find((t) => t.platform === platform);
        if (!entry) return { ok: false, error: `v${engineVersion} publishes no ${platform} template` };

        const res = await fetchImpl(`${base}/${entry.file}`);
        if (!res.ok || !res.body) return { ok: false, error: `download failed (HTTP ${res.status})` };

        mkdirSync(staging, { recursive: true });
        const file = path.join(staging, entry.file);
        const digest = createHash('sha256');
        let received = 0;
        const sink = createWriteStream(file);
        for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
            digest.update(chunk);
            received += chunk.byteLength;
            onProgress?.({ received, total: entry.bytes });
            if (!sink.write(chunk)) await once(sink, 'drain');
        }
        await new Promise<void>((resolve, reject) => sink.end((err?: Error) => (err ? reject(err) : resolve())));

        if (received !== entry.bytes) {
            return { ok: false, error: `download is ${received} bytes, the index says ${entry.bytes}` };
        }
        const got = digest.digest('hex');
        if (got !== entry.sha256) {
            return { ok: false, error: `checksum mismatch — got ${got.slice(0, 16)}…, expected ${entry.sha256.slice(0, 16)}…` };
        }
        return installNativeTemplate(file, engineVersion);
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
        rmSync(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
}

/** Delete an installed template. Takes the id + version rather than a path, so a
 *  renderer can never ask the main process to remove an arbitrary directory. */
export function removeNativeTemplate(platform: TemplatePlatform, engineVersion: string): boolean {
    const dir = installedTemplateDir(engineVersion, platform);
    if (!readTemplateManifest(dir)) return false;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    return true;
}
