// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    assetGroups.ts
 * @brief   The project's asset-delivery configuration model + resolver.
 *
 * `.esengine/asset-groups.json` is the SINGLE authored source for *which assets
 * ship where*: any folder can be marked a delivery group (local / subpackage /
 * remote-CDN), decoupling the delivery decision from a magic folder NAME. Build
 * profiles carry the CDN root per environment (dev / prod). This module is the
 * pure model + resolver shared by BOTH the cook (staging + manifest) and the
 * editor Play realm (its addressable manifest) — one implementation, so the two
 * can never disagree about what group an asset is in.
 *
 * Pure and dependency-free (no fs / DOM); the fs load lives in the cook / editor.
 */
import type { BundleMode } from './AddressableManifest';

/** User-facing delivery mode for a group. `subpackage` maps to the manifest's
 *  `lazy` bundle mode; `local`/`remote` map to themselves. */
export type AssetGroupMode = 'local' | 'subpackage' | 'remote';

/** One authored group: every asset under `folder` (recursively) joins it. */
export interface AssetGroupDef {
    /** Project-relative folder whose assets belong to this group. */
    folder: string;
    mode: AssetGroupMode;
}

/** A build environment's variables — currently just the CDN root remote groups
 *  are served from (dev vs prod differ; the export bakes the active one in). */
export interface BuildProfile {
    remoteRoot?: string;
}

/** The whole `.esengine/asset-groups.json` document. */
export interface AssetGroupsConfig {
    version: string;
    /** groupName → definition. */
    groups?: Record<string, AssetGroupDef>;
    /** Which profile is active for a build (key into `profiles`). */
    activeProfile?: string;
    profiles?: Record<string, BuildProfile>;
}

/** The group + delivery an asset resolves to (delivery is the manifest's typed
 *  {@link BundleMode}, so cook staging / manifest / runtime all speak one type). */
export interface ResolvedAssetGroup {
    name: string;
    delivery: BundleMode;
}

/** Map a user-facing mode to the manifest bundle mode (`subpackage` → `lazy`). */
export function modeToDelivery(mode: AssetGroupMode): BundleMode {
    return mode === 'subpackage' ? 'lazy' : mode;
}

const SUBPACKAGE_RE = /^subpackages\/([^/]+)\//;
const REMOTE_RE = /^remote\/([^/]+)\//;

/**
 * The delivery group an asset belongs to, in priority order:
 *   1. An explicit `config.groups` entry whose `folder` is (the longest) prefix
 *      of the asset's path — the modern, name-decoupled configuration.
 *   2. The legacy folder-name convention (`subpackages/<name>/` → lazy,
 *      `remote/<name>/` → remote) — kept as a zero-config default / back-compat.
 *   3. `main` / `local` — the eagerly-shipped default.
 *
 * Pure: `config` is the parsed document (or null when the project has none).
 * The SINGLE resolver the cook and the editor Play realm both call.
 */
export function resolveAssetGroup(
    projectRelPath: string,
    config: AssetGroupsConfig | null | undefined,
): ResolvedAssetGroup {
    const path = projectRelPath.replace(/\\/g, '/');

    if (config?.groups) {
        let best: { name: string; mode: AssetGroupMode; len: number } | null = null;
        for (const [name, def] of Object.entries(config.groups)) {
            const folder = def.folder.replace(/\\/g, '/').replace(/\/+$/, '');
            if (folder === '' ) continue;
            if (path === folder || path.startsWith(`${folder}/`)) {
                if (!best || folder.length > best.len) best = { name, mode: def.mode, len: folder.length };
            }
        }
        if (best) return { name: best.name, delivery: modeToDelivery(best.mode) };
    }

    const sub = SUBPACKAGE_RE.exec(path);
    if (sub) return { name: sub[1], delivery: 'lazy' };
    const rem = REMOTE_RE.exec(path);
    if (rem) return { name: rem[1], delivery: 'remote' };

    return { name: 'main', delivery: 'local' };
}

/** The CDN root of the active build profile (the value the export bakes into the
 *  shipped `game.config.json` so `remote`-group assets resolve against it).
 *  Undefined when no profile / no root is set. */
export function activeRemoteRoot(config: AssetGroupsConfig | null | undefined): string | undefined {
    const active = config?.activeProfile;
    if (!active) return undefined;
    const root = config?.profiles?.[active]?.remoteRoot;
    return root && root.trim() !== '' ? root.replace(/\/+$/, '') : undefined;
}
