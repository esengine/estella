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
import { existsSync, readFileSync, rmSync, renameSync, mkdirSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
    findTemplate, readTemplateManifest, missingTemplateFiles, installedTemplateDir,
    templateStoreDir, iosTemplateSources, DEFAULT_ABI,
    type NativePlatform, type NativeTemplateManifest,
} from '../../build-tools/utils/nativeTemplate.js';
import { extractZip } from '../../build-tools/utils/zip.js';

export type { NativePlatform, NativeTemplateManifest };

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
export function resolveNativeTemplate(platform: NativePlatform, engineVersion: string): UsableTemplate | null {
    const found = findTemplate({ platform, engineVersion });
    if (!found || found.missing.length > 0) return null;
    return { dir: found.dir, manifest: found.manifest };
}

/** The three files an iOS Xcode project is built around, or null without a template. */
export function iosSourcesFromTemplate(engineVersion: string): {
    xcframework: string; mainM: string; infoPlistIn: string;
} | null {
    const template = resolveNativeTemplate('ios', engineVersion);
    return template ? iosTemplateSources(template.dir) : null;
}

/** One row of the installed-template list. */
export interface NativeTemplateEntry {
    id: string;
    platform: string;
    abi: string;
    engineVersion: string;
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
                abi: manifest.abi,
                engineVersion: manifest.engineVersion,
                dir,
                current: manifest.engineVersion === engineVersion
                    && missingTemplateFiles(dir, manifest.platform, { abi: manifest.abi }).length === 0,
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
        const missing = missingTemplateFiles(staging, manifest.platform, { abi: manifest.abi });
        if (missing.length > 0) {
            return { ok: false, error: `incomplete template — missing ${missing.join(', ')}` };
        }

        const dest = installedTemplateDir(manifest.engineVersion, manifest.platform, manifest.abi, store);
        rmSync(dest, { recursive: true, force: true });
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
        rmSync(staging, { recursive: true, force: true });
    }
}

/** Delete an installed template. Takes the id + version rather than a path, so a
 *  renderer can never ask the main process to remove an arbitrary directory. */
export function removeNativeTemplate(platform: NativePlatform, abi: string, engineVersion: string): boolean {
    const dir = installedTemplateDir(engineVersion, platform, abi || DEFAULT_ABI[platform]);
    if (!readTemplateManifest(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
}
